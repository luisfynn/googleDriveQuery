/**
 * POST /api/search
 * Body: { searchFile: string, searchItem: string }
 * Response: NDJSON 스트림 - 각 줄이 하나의 SearchEvent
 *   {"type":"start","totalFiles":8}
 *   {"type":"scanning","current":1,"total":8,"fileName":"..."}
 *   {"type":"match","file":{...}}
 *   {"type":"done","matchedCount":3}
 *   {"type":"error","error":"...","hint":"..."}  ← 오류 시
 */

import { searchPricesStream } from "@/app/lib/drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5분 - 큰 검색 대비

function classifyError(err: unknown): { error: string; hint?: string } {
  let message = "검색 중 알 수 없는 오류가 발생했습니다.";
  let hint: string | undefined;

  if (err instanceof Error) {
    message = err.message;
    if (
      message.includes("Could not load") ||
      message.includes("default credentials")
    ) {
      hint =
        "로컬에서 인증이 안 됩니다. .env에 GOOGLE_APPLICATION_CREDENTIALS=./credentials.json 추가하거나 `gcloud auth application-default login` 실행하세요.";
    } else if (message.includes("403") || message.includes("permission")) {
      hint =
        "서비스 계정이 해당 Drive 폴더에 접근할 권한이 없습니다. credentials.json의 client_email을 폴더 공유 설정에 뷰어로 추가하세요.";
    } else if (
      message.includes("API has not been used") ||
      message.includes("disabled")
    ) {
      hint =
        "Drive API가 활성화되지 않았습니다: gcloud services enable drive.googleapis.com";
    }
  }
  return { error: message, hint };
}

export async function POST(request: Request) {
  let searchFile: string | undefined;
  let searchItem: string | undefined;

  try {
    const body = (await request.json()) as {
      searchFile?: string;
      searchItem?: string;
    };
    searchFile = body.searchFile?.trim();
    searchItem = body.searchItem?.trim();
  } catch {
    return new Response(
      JSON.stringify({ error: "잘못된 요청 본문" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!searchFile || !searchItem) {
    return new Response(
      JSON.stringify({ error: "업체명과 품목명을 모두 입력해 주세요." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      };

      try {
        for await (const event of searchPricesStream(searchFile!, searchItem!)) {
          send(event);
        }
      } catch (err) {
        console.error("[api/search] stream error:", err);
        send({ type: "error", ...classifyError(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no", // 프록시(nginx) 버퍼링 해제
    },
  });
}
