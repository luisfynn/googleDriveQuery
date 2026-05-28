"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface MatchedRow {
  idx: number;
  data: Record<string, string | number>;
}

interface MatchedFile {
  fileName: string;
  folderName: string;
  rows: MatchedRow[];
}

type SearchEvent =
  | { type: "start"; totalFiles: number }
  | { type: "scanning"; current: number; total: number; fileName: string }
  | { type: "match"; file: MatchedFile }
  | { type: "done"; matchedCount: number }
  | { type: "error"; error: string; hint?: string };

interface ScanProgress {
  current: number;
  total: number;
  fileName: string;
}

// ─── 유틸 ───────────────────────────────────────────────────────────

function meaningfulColumns(rows: MatchedRow[]): string[] {
  if (rows.length === 0) return [];
  const allCols = Object.keys(rows[0].data);
  return allCols.filter((col) => {
    if (/^__EMPTY(_\d+)?$/.test(col)) return false;
    if (!col.trim()) return false;
    const everyEmpty = rows.every((r) => {
      const v = r.data[col];
      return v === undefined || v === null || String(v).trim() === "";
    });
    return !everyEmpty;
  });
}

function isNumericCell(val: unknown): boolean {
  if (typeof val === "number") return true;
  if (typeof val !== "string") return false;
  const t = val.trim();
  if (!t) return false;
  return /^-?\d{1,3}(,\d{3})*(\.\d+)?$|^-?\d+(\.\d+)?$/.test(t);
}

function cellHasHit(val: unknown, term: string): boolean {
  if (!term) return false;
  return String(val).toLowerCase().includes(term.toLowerCase());
}

// ─── 표 상단·하단 동기 스크롤 래퍼 ────────────────────────────────

function DualScroll({ children }: { children: React.ReactNode }) {
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const lockRef = useRef<"top" | "bottom" | null>(null);

  useEffect(() => {
    const sync = () => {
      if (!contentRef.current || !spacerRef.current) return;
      spacerRef.current.style.width = contentRef.current.scrollWidth + "px";
    };
    sync();
    const ro = new ResizeObserver(sync);
    if (contentRef.current) ro.observe(contentRef.current);
    window.addEventListener("resize", sync);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, []);

  const handleTopScroll = useCallback(() => {
    if (lockRef.current === "bottom") {
      lockRef.current = null;
      return;
    }
    if (!topRef.current || !bottomRef.current) return;
    lockRef.current = "top";
    bottomRef.current.scrollLeft = topRef.current.scrollLeft;
  }, []);

  const handleBottomScroll = useCallback(() => {
    if (lockRef.current === "top") {
      lockRef.current = null;
      return;
    }
    if (!topRef.current || !bottomRef.current) return;
    lockRef.current = "bottom";
    topRef.current.scrollLeft = bottomRef.current.scrollLeft;
  }, []);

  return (
    <>
      <div
        ref={topRef}
        className="df-scroll-top"
        onScroll={handleTopScroll}
        aria-hidden
      >
        <div ref={spacerRef} className="df-scroll-spacer" />
      </div>
      <div
        ref={bottomRef}
        className="df-scroll"
        onScroll={handleBottomScroll}
      >
        <div ref={contentRef}>{children}</div>
      </div>
    </>
  );
}

// ─── 메인 ───────────────────────────────────────────────────────────

export default function Home() {
  const [searchFile, setSearchFile] = useState("");
  const [searchItem, setSearchItem] = useState("");
  const [lastSearchItem, setLastSearchItem] = useState("");

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [results, setResults] = useState<MatchedFile[]>([]);
  const [doneCount, setDoneCount] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorHint, setErrorHint] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const handleSearch = async () => {
    if (!searchFile.trim() || !searchItem.trim()) {
      setErrorMsg("업체명과 품목명을 모두 입력해 주세요.");
      setErrorHint(null);
      return;
    }

    // 이전 검색 진행 중이면 취소
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setErrorMsg(null);
    setErrorHint(null);
    setResults([]);
    setDoneCount(null);
    setProgress(null);
    setLastSearchItem(searchItem);

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ searchFile, searchItem }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        // 검증 실패 등 비스트림 응답
        try {
          const data = (await res.json()) as { error?: string; hint?: string };
          setErrorMsg(data.error ?? `HTTP ${res.status}`);
          if (data.hint) setErrorHint(data.hint);
        } catch {
          setErrorMsg(`HTTP ${res.status}`);
        }
        return;
      }

      // NDJSON 스트림 읽기 - 한 줄씩 파싱하면서 즉시 적용
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let nl;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          try {
            const event = JSON.parse(line) as SearchEvent;
            applyEvent(event);
          } catch (e) {
            console.warn("[stream] parse fail:", line, e);
          }
        }
      }

      // 마지막 잔여
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer.trim()) as SearchEvent;
          applyEvent(event);
        } catch (e) {
          console.warn("[stream] final parse fail:", buffer, e);
        }
      }
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      setErrorMsg(err instanceof Error ? err.message : "알 수 없는 오류");
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  const applyEvent = (event: SearchEvent) => {
    switch (event.type) {
      case "start":
        // totalFiles 정보 - 진행 표시 초기화
        setProgress({ current: 0, total: event.totalFiles, fileName: "" });
        break;
      case "scanning":
        setProgress({
          current: event.current,
          total: event.total,
          fileName: event.fileName,
        });
        break;
      case "match":
        // 매칭 즉시 결과 리스트에 추가
        setResults((prev) => [...prev, event.file]);
        break;
      case "done":
        setDoneCount(event.matchedCount);
        break;
      case "error":
        setErrorMsg(event.error);
        if (event.hint) setErrorHint(event.hint);
        break;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !loading) handleSearch();
  };

  return (
    <main className="page">
      <header className="app-header">
        <h1 className="app-title">📊 단가 검색기</h1>
        <p className="app-subtitle">
          누구나 쉽게 원자재/품목의 최근 5년 가격 추이를 확인하세요.
        </p>
      </header>

      <section className="card">
        <h2 className="card-title">🔍 상세 단가 검색</h2>

        <div className="search-grid">
          <div>
            <label htmlFor="search-file" className="field-label">
              📁 업체/파일명{" "}
              <span style={{ color: "var(--text-mute)" }}>(예: 선진)</span>
            </label>
            <input
              id="search-file"
              type="text"
              value={searchFile}
              onChange={(e) => setSearchFile(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
              autoFocus
              placeholder="업체명 또는 파일명 일부"
            />
          </div>
          <div>
            <label htmlFor="search-item" className="field-label">
              📦 찾을 품목{" "}
              <span style={{ color: "var(--text-mute)" }}>(예: pa 화이트)</span>
            </label>
            <input
              id="search-item"
              type="text"
              value={searchItem}
              onChange={(e) => setSearchItem(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
              placeholder="품목명 일부"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={handleSearch}
          disabled={loading}
          className="btn-search"
        >
          {loading ? "검색 중…" : "🔎 데이터 검색하기"}
        </button>
      </section>

      {/* 에러 */}
      {errorMsg && (
        <div className="alert alert-error">
          <span className="alert-icon">❗</span>
          <div className="alert-content">
            <div>
              <strong>{errorMsg}</strong>
            </div>
            {errorHint && <div className="alert-hint">💡 {errorHint}</div>}
          </div>
        </div>
      )}

      {/* 진행 상태 (검색 중 + 부분 결과 있을 수 있음) */}
      {loading && progress && (
        <div className="progress-bar">
          <div className="progress-head">
            <span className="spinner"></span>
            <span className="progress-text">
              <strong>{searchFile}</strong> 관련 파일 검사 중{" "}
              <span className="progress-counter">
                {progress.current} / {progress.total}
              </span>
            </span>
          </div>
          {progress.fileName && (
            <div className="progress-current">
              현재: <span className="progress-filename">{progress.fileName}</span>
            </div>
          )}
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{
                width:
                  progress.total > 0
                    ? `${(progress.current / progress.total) * 100}%`
                    : "0%",
              }}
            />
          </div>
        </div>
      )}

      {/* 검색 완료 - 결과 0건 (에러 아닌 경우) */}
      {!loading && doneCount === 0 && !errorMsg && (
        <div className="alert alert-warn">
          <span className="alert-icon">⚠️</span>
          <div className="alert-content">
            파일은 찾았지만, 문서 안에 <strong>{lastSearchItem}</strong>{" "}
            데이터가 없습니다.
          </div>
        </div>
      )}

      {/* 검색 완료 요약 (결과 있는 경우) */}
      {!loading && doneCount !== null && doneCount > 0 && (
        <div className="alert alert-success">
          <span className="alert-icon">✅</span>
          <div className="alert-content">
            검색 완료 — <strong>{doneCount}건</strong>의 파일에서 매칭 데이터를
            찾았습니다.
          </div>
        </div>
      )}

      {/* 결과 (스트림 도착 즉시 누적 표시) */}
      {results.length > 0 && (
        <section className="result-section">
          {results.map((r, i) => {
            const cols = meaningfulColumns(r.rows);
            return (
              <div key={i} className="result-block fade-in">
                <div className="result-header">
                  <div className="result-meta">
                    <span className="result-tag">매칭 #{i + 1}</span>
                    <span className="result-filename">{r.fileName}</span>
                    <span className="result-location">
                      📁 {r.folderName} · {r.rows.length}행
                    </span>
                  </div>
                </div>

                <div className="df-frame">
                  <DualScroll>
                    <table className="df-table">
                      <thead>
                        <tr>
                          <th className="col-idx">#</th>
                          {cols.map((col) => (
                            <th key={col}>{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {r.rows.map((row, ri) => (
                          <tr key={ri}>
                            <td className="col-idx">{row.idx}</td>
                            {cols.map((col) => {
                              const val = row.data[col];
                              const isNum = isNumericCell(val);
                              const isHit = cellHasHit(val, lastSearchItem);
                              const cls = [
                                isNum ? "col-num" : "",
                                isHit ? "col-hit" : "",
                              ]
                                .filter(Boolean)
                                .join(" ");
                              return (
                                <td key={col} className={cls || undefined}>
                                  {String(val)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </DualScroll>
                </div>
              </div>
            );
          })}
        </section>
      )}

      <footer className="app-footer">
        <span>Price Lens · 사내 단가 검색기</span>
        <span>Powered by Google Drive API</span>
      </footer>
    </main>
  );
}
