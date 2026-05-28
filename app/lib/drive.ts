/**
 * Google Drive 검색 로직 (스트리밍 버전).
 * 매칭된 파일을 발견하는 즉시 yield 하므로 클라이언트가 결과를
 * 하나씩 받아 화면에 추가할 수 있다.
 */

import { google, type drive_v3 } from "googleapis";
import * as XLSX from "xlsx";

export interface MatchedRow {
  idx: number;
  data: Record<string, string | number>;
}

export interface MatchedFile {
  fileName: string;
  folderName: string;
  rows: MatchedRow[];
}

/** 클라이언트로 스트리밍되는 이벤트 종류 */
export type SearchEvent =
  | { type: "start"; totalFiles: number }
  | { type: "scanning"; current: number; total: number; fileName: string }
  | { type: "match"; file: MatchedFile }
  | { type: "done"; matchedCount: number };

let driveSingleton: drive_v3.Drive | null = null;

function getDrive(): drive_v3.Drive {
  if (driveSingleton) return driveSingleton;
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  driveSingleton = google.drive({ version: "v3", auth });
  return driveSingleton;
}

function toBuffer(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (data instanceof Uint8Array) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof data === "string") return Buffer.from(data, "binary");
  throw new Error(
    `Unexpected file content type: ${Object.prototype.toString.call(data)}`
  );
}

/**
 * 단가 검색 - async generator로 결과를 점진적으로 산출.
 */
export async function* searchPricesStream(
  searchFile: string,
  searchItem: string
): AsyncGenerator<SearchEvent> {
  const drive = getDrive();
  const searchTerm = searchItem.toLowerCase();

  // 1) 파일명 매칭 검색
  const escapedFile = searchFile.replace(/'/g, "\\'");
  const listRes = await drive.files.list({
    q: `name contains '${escapedFile}' and mimeType != 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id, name, parents)",
    pageSize: 100,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const files = listRes.data.files ?? [];
  console.log(`[drive] '${searchFile}' 매칭 파일: ${files.length}건`);

  yield { type: "start", totalFiles: files.length };

  if (files.length === 0) {
    yield { type: "done", matchedCount: 0 };
    return;
  }

  // 2) 각 파일 검사 + 매칭 시 즉시 yield
  const folderCache = new Map<string, string>();
  let matchedCount = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file.id) continue;

    yield {
      type: "scanning",
      current: i + 1,
      total: files.length,
      fileName: file.name ?? "(이름없음)",
    };

    try {
      // 부모 폴더명 (캐시)
      let folderName = "알 수 없는 경로";
      const parentId = file.parents?.[0];
      if (parentId) {
        if (!folderCache.has(parentId)) {
          try {
            const meta = await drive.files.get({
              fileId: parentId,
              fields: "name",
              supportsAllDrives: true,
            });
            folderCache.set(parentId, meta.data.name ?? "알 수 없는 경로");
          } catch {
            folderCache.set(parentId, "알 수 없는 경로");
          }
        }
        folderName = folderCache.get(parentId) ?? folderName;
      }

      // 파일 다운로드 (메모리)
      const dl = await drive.files.get(
        { fileId: file.id, alt: "media", supportsAllDrives: true },
        { responseType: "arraybuffer" }
      );

      const buf = toBuffer(dl.data);
      const wb = XLSX.read(buf, { type: "buffer" });
      const sheetName = wb.SheetNames[0];
      if (!sheetName) continue;
      const sheet = wb.Sheets[sheetName];

      const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(
        sheet,
        { defval: "" }
      );

      // 원본 인덱스 유지하면서 매칭
      const hits: MatchedRow[] = [];
      rows.forEach((row, idx) => {
        if (
          Object.values(row).some((v) =>
            String(v).toLowerCase().includes(searchTerm)
          )
        ) {
          hits.push({ idx, data: row });
        }
      });

      if (hits.length > 0) {
        matchedCount++;
        console.log(`[drive] ${file.name} → ${hits.length}행 매칭`);
        yield {
          type: "match",
          file: {
            fileName: file.name ?? "(이름없음)",
            folderName,
            rows: hits,
          },
        };
      }
    } catch (err) {
      console.error(`[drive] skip ${file.name}:`, err);
    }
  }

  yield { type: "done", matchedCount };
}
