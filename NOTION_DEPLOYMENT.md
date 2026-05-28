# 📊 GoogleQuery (Price Lens) 셋업 & 배포 가이드

> **사내 단가 검색기**를 GCP에 완전히 처음부터 셋업하고 배포하는 통합 문서.
> Google Drive에 흩어진 단가 엑셀을 두 단어로 즉시 검색하는 Next.js 웹앱.

---

## 📌 한눈에 보기

| 항목 | 내용 |
|---|---|
| **언어/프레임워크** | TypeScript · Next.js 16 · React 19 |
| **스타일링** | Tailwind v4 + 자체 디자인 시스템 (Pretendard) |
| **데이터 소스** | Google Drive (Drive API v3) |
| **엑셀 파싱** | SheetJS (xlsx) |
| **호스팅** | Google Cloud Run (asia-northeast3 / 서울) |
| **빌드** | Cloud Build → Artifact Registry |
| **인증** | 서비스 계정 (로컬은 `credentials.json`, 배포는 Cloud Run이 자동 사용) |
| **스트리밍** | NDJSON 스트림 — 파일 매칭 즉시 클라이언트로 전달 |
| **예상 비용** | 월 ₩3,000~5,000 (min-instances=1 기준) |

---

## 🏗 아키텍처

```
[사내 사용자 브라우저]
       │ HTTPS
       ▼
┌─────────────────────────────────────┐
│  Cloud Run: googlequery-service     │
│  (asia-northeast3, Next.js 컨테이너) │
├─────────────────────────────────────┤
│  Frontend (React)                   │
│    └─ /                             │
│       검색 폼 + 결과 카드           │
│                                     │
│  API Route                          │
│    └─ POST /api/search              │
│       NDJSON 스트림 반환            │
│       (start/scanning/match/done)   │
│                                     │
│  Drive API 호출                     │
│    └─ googleapis (Node SDK)         │
│       서비스 계정으로 자동 인증     │
└─────────────────────────────────────┘
       │
       ▼ 검색 + 다운로드
[Google Drive 공유 드라이브]
       └─ 서비스 계정에 뷰어 권한
```

---

# Part 1. GCP 환경 처음부터 만들기

## 1-1. 사전 준비물

로컬에 깔려 있어야 할 것:

| 도구 | 설치 |
|---|---|
| **Node.js 20+** | https://nodejs.org/ (LTS 권장) |
| **Google Cloud SDK** | https://cloud.google.com/sdk/docs/install |
| **Git** | https://git-scm.com/ |
| **VS Code** (선택) | https://code.visualstudio.com/ |

설치 확인:
```powershell
node --version    # v20.x.x
npm --version     # 10.x.x
gcloud --version  # Google Cloud SDK 4xx.x.x
```

## 1-2. GCP 프로젝트 새로 만들기 (선택)

이미 회사에서 쓰는 프로젝트가 있으면 건너뛰고 [1-3](#1-3-gcloud-로그인-및-프로젝트-선택)으로.

새로 만들 경우:

```powershell
# 1. 프로젝트 생성 (전역 고유 ID 필요, 자동 접미사 붙는 게 일반적)
gcloud projects create price-lens --name="Price Lens"
# → 만약 이름이 중복이면 "price-lens-xxxx" 같은 ID로 자동 생성됨

# 2. 결제 계정 연결 (필수, 결제 안 해도 무료 티어로 운영 가능)
# 콘솔에서 처리: https://console.cloud.google.com/billing
```

## 1-3. gcloud 로그인 및 프로젝트 선택

```powershell
# 1. Google 계정 로그인 (브라우저 열림)
gcloud auth login

# 2. ADC (Application Default Credentials) 설정 - 로컬 개발용
gcloud auth application-default login

# 3. 사용할 프로젝트 확인
gcloud projects list

# 출력 예시:
# PROJECT_ID            NAME           PROJECT_NUMBER
# price-lens-496001     Price Lens     123456789012
# web3platform          Web3 Platform  234567890123

# 4. 작업 프로젝트 지정
gcloud config set project price-lens-496001
```

> ⚠️ **권한 확인**: `Permission denied` 에러가 뜨면 본인 계정이 그 프로젝트의 멤버가 아닌 것. 프로젝트 소유자에게 [IAM 콘솔](https://console.cloud.google.com/iam-admin/iam)에서 **Owner** 또는 **Editor** 역할 추가 요청.

## 1-4. 필요한 API 활성화

다섯 개 API 한 번에 켜기:

```powershell
gcloud services enable `
  run.googleapis.com `
  cloudbuild.googleapis.com `
  artifactregistry.googleapis.com `
  iam.googleapis.com `
  drive.googleapis.com
```

각 API 역할:
- **Cloud Run** — 컨테이너 호스팅
- **Cloud Build** — 소스 → 도커 이미지 빌드
- **Artifact Registry** — 빌드된 이미지 저장소
- **IAM** — 서비스 계정 관리
- **Drive API** — 우리 앱이 Drive 호출

---

# Part 2. 서비스 계정 + Drive 권한

## 2-1. 서비스 계정 생성

Drive를 읽을 전용 SA를 만든다. 이미 있으면 [2-3](#2-3-drive-폴더-공유)로.

```powershell
$PROJ_ID = "price-lens-496001"
$SA_NAME = "price-lens"
$SA_EMAIL = "$SA_NAME@$PROJ_ID.iam.gserviceaccount.com"

# 서비스 계정 생성
gcloud iam service-accounts create $SA_NAME `
    --display-name="Price Lens Drive Reader" `
    --project=$PROJ_ID
```

## 2-2. 키 JSON 다운로드 (로컬 개발용)

로컬에서 ADC로 인증할 수 있게 키 파일 발급:

```powershell
gcloud iam service-accounts keys create credentials.json `
    --iam-account=$SA_EMAIL `
    --project=$PROJ_ID
```

`credentials.json`이 프로젝트 루트에 생성됨. **절대 git에 커밋하지 말 것** (이미 `.gitignore` 처리됨).

> 🔒 **보안**: 이 키 파일이 노출되면 누구든 Drive를 읽을 수 있음. 분실하면 즉시 [IAM 콘솔](https://console.cloud.google.com/iam-admin/serviceaccounts)에서 해당 키 폐기 후 재발급.

## 2-3. Drive 폴더 공유

이 단계가 핵심. 서비스 계정 이메일을 검색 대상 Drive 폴더에 **뷰어**로 추가해야 앱이 폴더 내용을 읽을 수 있다.

1. `credentials.json`의 `client_email` 값 확인:
   ```powershell
   Get-Content credentials.json | ConvertFrom-Json | Select-Object client_email
   ```
   출력 예: `price-lens@price-lens-496001.iam.gserviceaccount.com`

2. 브라우저에서 Google Drive 열기 → 검색 대상 폴더 우클릭 → **공유**

3. 위 이메일 붙여넣기 → 권한 **뷰어**로 설정 → **알림 보내기 끔** → **공유**

> 💡 **공유 드라이브**의 경우 폴더 자체가 아니라 공유 드라이브 멤버로 SA를 추가해야 함 (관리자 권한 필요).

## 2-4. 서비스 계정 권한 정리

| 위치 | 역할 |
|---|---|
| **Drive 폴더** | 뷰어 (Viewer) — 데이터 읽기용 |
| **GCP 프로젝트** | 없어도 됨 (기본) — Cloud Run이 자기 자신을 SA로 실행할 때 추가 권한 불필요 |

배포 시 본인(`luisfynn1@gmail.com` 같은 개발자 계정)에게 추가로 필요한 권한:
- `roles/iam.serviceAccountUser` — Cloud Run을 SA로 실행시키기 위해 필요. Owner면 자동 포함.

본인이 Owner가 아니면 IAM에서 본인 계정에 **Service Account User** 역할 추가.

---

# Part 3. 로컬 개발 환경

## 3-1. 프로젝트 폴더 구성

```
GoogleQuery/
├── .git/
├── .gitignore                # node_modules, .env, credentials.json 제외
├── .dockerignore             # 도커 빌드 시 제외 파일
├── .env                      # 로컬 환경변수 (gitignore됨)
├── .env.example              # 환경변수 템플릿
├── credentials.json          # SA 키 (로컬 전용, gitignore됨)
├── package.json              # Node.js 의존성
├── tsconfig.json             # TypeScript 설정
├── next.config.ts            # Next.js 설정
├── postcss.config.mjs        # Tailwind v4
├── eslint.config.mjs
├── Dockerfile                # Cloud Run 컨테이너 정의
├── cloudbuild.yaml           # Cloud Build 설정
├── deploy.ps1                # 배포 스크립트
├── README.md
├── NOTION_DEPLOYMENT.md      # 이 문서
└── app/
    ├── layout.tsx            # 루트 레이아웃
    ├── page.tsx              # 메인 UI
    ├── globals.css           # 디자인 시스템
    ├── lib/
    │   └── drive.ts          # Drive 쿼리 + 엑셀 파싱 (스트리밍 generator)
    └── api/
        └── search/
            └── route.ts      # POST /api/search → NDJSON 스트림
```

## 3-2. 의존성 설치

```powershell
cd C:\Users\medit\Desktop\WorkSpace\GoogleQuery

npm install
```

설치되는 핵심 패키지:
- `next`, `react`, `react-dom` — Next.js 풀스택
- `googleapis` — Google Drive API SDK
- `xlsx` (SheetJS) — 엑셀 파싱
- `tailwindcss`, `@tailwindcss/postcss` — 스타일링

## 3-3. `.env` 파일 만들기

```powershell
Copy-Item .env.example .env
notepad .env
```

`.env` 내용:

```env
# GCP 프로젝트 ID (gcloud projects list에서 확인한 값)
GCP_PROJECT_ID=price-lens-496001

# 로컬에서 Drive API 호출 시 사용할 SA 키 경로
# Next.js dev 서버가 자동으로 이 환경변수를 인식
GOOGLE_APPLICATION_CREDENTIALS=./credentials.json
```

## 3-4. 로컬에서 실행

```powershell
npm run dev
```

브라우저: http://localhost:3000

확인 사항:
- 페이지 로딩 OK
- 업체명 + 품목명 입력 → "🔎 데이터 검색하기" 클릭
- 진행 바가 `1/8 → 2/8 → …` 식으로 차오르면서 매칭된 카드가 하나씩 나타남
- 매칭된 셀이 살구색으로 강조됨

문제 발생 시 [Part 8 트러블슈팅](#part-8-트러블슈팅) 참조.

---

# Part 4. 코드 구조 이해

## 4-1. 검색 흐름

```
사용자 클릭
   │
   ▼
[page.tsx] fetch('/api/search', { method: 'POST', body: { searchFile, searchItem } })
   │
   ▼
[route.ts] ReadableStream으로 NDJSON 응답
   │     └─ searchPricesStream() async generator를 await for로 순회
   │
   ▼
[drive.ts] 다음을 순차 수행:
   1. drive.files.list — 이름에 searchFile 포함된 파일 목록
   2. yield { type: "start", totalFiles }
   3. 각 파일마다:
       - yield { type: "scanning", current, total, fileName }
       - drive.files.get(alt: 'media') — 메모리에 다운로드
       - XLSX.read → 첫 시트의 모든 행을 JSON으로
       - 각 행의 셀 중 하나라도 searchItem 포함하면 매칭
       - 매칭이 있으면 yield { type: "match", file }
   4. yield { type: "done", matchedCount }
   │
   ▼
[page.tsx] reader.read()로 한 청크씩 받으며 줄바꿈 단위로 JSON.parse
   - "scanning" → 진행 바 갱신
   - "match" → results 배열에 push (즉시 UI 추가)
   - "done" → 검색 완료 메시지
```

## 4-2. 인증 동작 원리

`drive.ts`의 인증 코드 단 한 줄:

```typescript
const auth = new google.auth.GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/drive.readonly"],
});
```

`GoogleAuth` 객체가 다음 순서로 자격증명을 자동 탐색:

1. **`GOOGLE_APPLICATION_CREDENTIALS` 환경변수** → 파일 경로면 그 JSON 읽음
2. **`gcloud auth application-default login`** 으로 저장된 사용자 인증
3. **Metadata server** (Compute Engine / Cloud Run / GKE 환경)

| 환경 | 사용되는 자격증명 |
|---|---|
| 로컬 (npm run dev) | `.env`의 `GOOGLE_APPLICATION_CREDENTIALS=./credentials.json` |
| Cloud Run | `--service-account` 플래그로 지정한 SA (메타데이터 서버 자동) |

→ **코드 한 줄로 양쪽 다 동작**. 키 파일이 클라우드에 올라갈 일도 없음.

## 4-3. 스트리밍 프로토콜 (NDJSON)

서버가 `Content-Type: application/x-ndjson`로 한 줄에 한 JSON씩 전송:

```jsonl
{"type":"start","totalFiles":8}
{"type":"scanning","current":1,"total":8,"fileName":"선진산업.xlsm"}
{"type":"scanning","current":2,"total":8,"fileName":"선진기업.xlsm"}
{"type":"match","file":{"fileName":"선진산업.xlsm","folderName":"2026 매출","rows":[...]}}
{"type":"scanning","current":3,"total":8,"fileName":"선진..."}
...
{"type":"done","matchedCount":3}
```

클라이언트는 `response.body.getReader()`로 청크 단위 수신 → 줄바꿈 발견 즉시 `JSON.parse` → React state 업데이트 → 즉시 화면 반영.

---

# Part 5. 배포 (최초)

## 5-1. 권한 사전 확인

배포 실행자(본인 계정)에게 필요한 IAM 역할:

| 역할 | 용도 |
|---|---|
| `roles/run.admin` | Cloud Run 서비스 생성/수정 |
| `roles/cloudbuild.builds.editor` | Cloud Build 실행 |
| `roles/artifactregistry.admin` | 레포지토리 생성 + 이미지 푸시 |
| `roles/iam.serviceAccountUser` | Cloud Run을 SA로 실행 |
| `roles/storage.admin` | Cloud Build 임시 스토리지 |

본인이 `Owner`이면 위 다 포함됨. 아니면 [IAM 콘솔](https://console.cloud.google.com/iam-admin/iam)에서 추가.

## 5-2. 배포 스크립트 실행

```powershell
cd C:\Users\medit\Desktop\WorkSpace\GoogleQuery
.\deploy.ps1
```

스크립트가 자동으로:

1. **.env 로드** — `GCP_PROJECT_ID` 읽음
2. **credentials.json의 SA 이메일 자동 추출** — `--service-account` 플래그로 Cloud Run에 전달
3. **Artifact Registry 레포지토리** — `googlequery-repo` 없으면 생성
4. **Cloud Build로 도커 이미지 빌드** — 3~5분 (첫 빌드)
5. **Cloud Run 배포** — `googlequery-service`라는 이름으로
6. **서비스 URL 출력**

성공 로그 예시:
```
✅ .env 파일 로드 완료
✅ 서비스 계정: price-lens@price-lens-496001.iam.gserviceaccount.com
✅ Artifact Registry 준비 완료
✅ 빌드 완료
🚀 3단계: Cloud Run 배포 중...
✅ 배포 완료!
🌐 URL: https://googlequery-service-xxxxx-du.a.run.app
```

## 5-3. 동작 확인

브라우저에서 그 URL 열기 → 로컬과 동일하게 검색해보기.

> ⚠️ Cloud Run의 SA(여기선 `price-lens@...`)는 이미 Drive 폴더 뷰어 권한을 가지고 있어야 함. 로컬 테스트에서 검색이 됐다면 이미 OK.

## 5-4. 컨테이너 항상 켜두기

기본값(`min-instances=0`)이면 트래픽 없을 때 컨테이너가 종료되어 다음 접속 시 5~15초 콜드스타트 발생. 사내 도구로 즉각 응답이 필요하면 콘솔에서 설정:

1. https://console.cloud.google.com/run?project=price-lens-496001
2. `googlequery-service` 클릭
3. 상단 **EDIT & DEPLOY NEW REVISION**
4. 좌측 메뉴 **인스턴스**
5. **Minimum number of instances** = `1`
6. (선택) **Memory** = `1 GiB` — 큰 엑셀 처리 대비
7. **배포**

이 설정은 리비전 메타데이터로 저장되어 재배포해도 유지됨.

비용 영향:
- min-instances=0: **₩0** (무료 티어 내)
- min-instances=1 + 512Mi 메모리: 약 **₩3,000~4,000/월**
- min-instances=1 + 1Gi 메모리: 약 **₩7,000~8,000/월**

---

# Part 6. 재배포 & 운영

## 6-1. 재배포 (코드 수정 후)

```powershell
.\deploy.ps1
```

진행 단계는 최초 배포와 같지만:
- Artifact Registry는 이미 존재 → 통과
- 이미지 빌드는 캐시 활용 → 1~2분으로 단축
- 새 리비전이 생성되어 트래픽 100% 자동 라우팅 (무중단)
- 이전 리비전은 자동으로 보관되며 콘솔에서 롤백 가능

## 6-2. 로그 확인

```powershell
# 최근 50줄
gcloud run services logs read googlequery-service `
  --region=asia-northeast3 --limit=50

# 실시간 tail (Ctrl+C로 종료)
gcloud beta run services logs tail googlequery-service `
  --region=asia-northeast3
```

또는 콘솔: https://console.cloud.google.com/run/detail/asia-northeast3/googlequery-service/logs

## 6-3. 메트릭 / 비용

| 모니터링 | 위치 |
|---|---|
| 요청 수, 응답 시간 | Cloud Run → 서비스 → **METRICS** 탭 |
| 비용 추이 | https://console.cloud.google.com/billing |
| 인스턴스 활동 | Cloud Run → 서비스 → **REVISIONS** 탭 |

## 6-4. 환경변수 추가/수정

새 환경변수 필요할 때:

```powershell
gcloud run services update googlequery-service `
  --region=asia-northeast3 `
  --update-env-vars "MY_NEW_VAR=value"
```

## 6-5. 서비스 일시 중지 / 삭제

```powershell
# 트래픽 차단 (인스턴스는 유지)
gcloud run services update googlequery-service `
  --no-traffic --region=asia-northeast3

# 완전 삭제
gcloud run services delete googlequery-service --region=asia-northeast3
gcloud artifacts repositories delete googlequery-repo --location=asia-northeast3
```

---

# Part 7. 부록

## 7-1. 사내 인증만 허용 (Cloud IAM Authentication)

URL을 알아도 회사 Google 계정 로그인 없이는 접근 불가능하게 만들기:

```powershell
# 1. 공개 액세스 차단
gcloud run services update googlequery-service `
  --no-allow-unauthenticated `
  --region=asia-northeast3

# 2. 특정 사용자 또는 그룹에 접근 권한
gcloud run services add-iam-policy-binding googlequery-service `
  --region=asia-northeast3 `
  --member="user:your.email@medit.com" `
  --role="roles/run.invoker"

# 또는 도메인 전체
# --member="domain:medit.com"

# 또는 그룹
# --member="group:engineers@medit.com"
```

접속 시 Google 계정 로그인 화면이 뜸. 허용 멤버만 입장 가능.

## 7-2. 커스텀 도메인 연결

```powershell
gcloud run domain-mappings create `
  --service=googlequery-service `
  --domain=pricelens.medit.com `
  --region=asia-northeast3
```

→ 출력되는 DNS 레코드(CNAME 또는 A)를 도메인 관리 콘솔에 추가. SSL 인증서는 Cloud Run이 자동 발급/갱신.

## 7-3. 검색 범위를 특정 폴더로 제한하기

현재 코드는 SA가 접근 가능한 모든 파일을 검색. 특정 Drive 폴더 안에서만 검색하려면:

`app/lib/drive.ts`의 쿼리에 `'<folder-id>' in parents` 추가:

```typescript
const escapedFile = searchFile.replace(/'/g, "\\'");
const folderId = process.env.DRIVE_FOLDER_ID;

const q = folderId
  ? `name contains '${escapedFile}' and '${folderId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false`
  : `name contains '${escapedFile}' and mimeType != 'application/vnd.google-apps.folder' and trashed = false`;
```

그리고 `deploy.ps1`에서 `--set-env-vars`로 `DRIVE_FOLDER_ID` 전달.

> ⚠️ `in parents`는 직속 자식만 매칭. 재귀 탐색을 하려면 별도 트리 탐색 로직 필요.

## 7-4. 비용 절약 팁

| 옵션 | 효과 |
|---|---|
| `min-instances=0` | 트래픽 없을 때 0원 (단, 콜드스타트 5~15초) |
| `--memory=512Mi` 유지 | 1Gi 대비 비용 절반 |
| `--max-instances=3` | 트래픽 폭주 시 비용 폭주 차단 |
| 도구 페이지에 사내 인증 적용 | 외부 봇/크롤러 차단 |

## 7-5. CI/CD 자동화 (선택)

GitHub Actions로 main 브랜치 push 시 자동 배포:

`.github/workflows/deploy.yml` 예시:
```yaml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}
      - uses: google-github-actions/setup-gcloud@v2
      - run: |
          gcloud builds submit --config cloudbuild.yaml \
            --substitutions _IMAGE_PATH=asia-northeast3-docker.pkg.dev/${{ secrets.GCP_PROJECT_ID }}/googlequery-repo/nextjs-app
          gcloud run deploy googlequery-service \
            --image asia-northeast3-docker.pkg.dev/${{ secrets.GCP_PROJECT_ID }}/googlequery-repo/nextjs-app \
            --region asia-northeast3 \
            --service-account ${{ secrets.GCP_SA_EMAIL }}
```

---

# Part 8. 트러블슈팅

| 증상 | 원인 | 해결 |
|---|---|---|
| `Permission denied to enable service` | 본인 계정이 프로젝트 멤버 아님 | `gcloud projects list`로 권한 확인 후 IAM에서 추가 |
| `Could not load the default credentials` (로컬) | `.env`에 GOOGLE_APPLICATION_CREDENTIALS 누락 | `GOOGLE_APPLICATION_CREDENTIALS=./credentials.json` 추가 + dev 서버 재시작 |
| `Could not load the default credentials` (Cloud Run) | `--service-account` 미지정 | `credentials.json`이 폴더에 있는지 확인, deploy.ps1 다시 실행 |
| `403 Forbidden` (Drive) | SA가 폴더에 공유 안 됨 | [2-3](#2-3-drive-폴더-공유) 다시 |
| 파일은 찾는데 행 매칭 0건 | 첫 시트에 데이터 없거나 검색어 오타 | 엑셀 직접 열어 첫 시트 확인 |
| `__EMPTY` 컬럼이 보임 | 엑셀 첫 행에 빈 셀 있음 | 코드가 자동 필터링하므로 발생하지 않음. 보인다면 dev 재시작 |
| 큰 엑셀에서 OOM | 메모리 부족 | 콘솔에서 메모리 1Gi 또는 2Gi로 |
| 빌드 시 `xlsx` 설치 실패 | SheetJS CDN 차단 | 회사 방화벽 문제. `package.json`의 xlsx URL 변경 또는 ProxyConfig |
| 콜드스타트가 너무 느림 | min-instances=0 | [5-4](#5-4-컨테이너-항상-켜두기) 참조 |
| `iam.serviceAccounts.actAs` denied | Service Account User 역할 누락 | 본인 계정에 IAM에서 추가 |
| 한글 입력했는데 UTF-8 안 맞음 | PowerShell 인코딩 | deploy.ps1 첫 줄의 `chcp 65001` 자동 처리됨 |

---

# Part 9. 명령어 치트시트

```powershell
# ─── 로컬 개발 ───
npm install
npm run dev        # http://localhost:3000
npm run build      # 프로덕션 빌드 테스트
npm run lint       # ESLint

# ─── GCP 인증 ───
gcloud auth login
gcloud auth application-default login
gcloud config set project price-lens-496001

# ─── 배포 ───
.\deploy.ps1

# ─── 상태 확인 ───
gcloud run services list --region=asia-northeast3
gcloud run services describe googlequery-service --region=asia-northeast3 --format=yaml
gcloud run services logs read googlequery-service --region=asia-northeast3 --limit=50

# ─── URL 확인 ───
gcloud run services describe googlequery-service --region=asia-northeast3 --format="value(status.url)"

# ─── 환경변수 업데이트 ───
gcloud run services update googlequery-service `
  --region=asia-northeast3 `
  --update-env-vars KEY=value

# ─── 트래픽 제어 ───
gcloud run services update-traffic googlequery-service `
  --region=asia-northeast3 `
  --to-revisions=googlequery-service-00002-abc=100

# ─── 삭제 ───
gcloud run services delete googlequery-service --region=asia-northeast3
gcloud artifacts repositories delete googlequery-repo --location=asia-northeast3
```

---

## 📚 참고 자료

- [Cloud Run 가격](https://cloud.google.com/run/pricing)
- [Drive API v3 문서](https://developers.google.com/drive/api/v3/reference)
- [Next.js App Router](https://nextjs.org/docs/app)
- [googleapis Node.js SDK](https://github.com/googleapis/google-api-nodejs-client)
- [SheetJS 문서](https://docs.sheetjs.com/)

---

> 📝 **문서 관리**: 코드 변경 시 본 문서의 관련 섹션도 함께 업데이트 권장.
> 마지막 업데이트: 2026-05
