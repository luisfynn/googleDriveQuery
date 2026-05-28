# 📊 Price Lens — 단가 검색기

Google Drive에 흩어진 단가 엑셀 파일을 한 번에 검색하는 사내 웹 도구.

## 🌟 Features

- **검색**: 업체명/파일명 + 품목명 두 단어로 전체 Drive 재귀 탐색 (공유 드라이브 포함)
- **DB 불필요**: Google Drive 자체를 데이터 소스로 사용, 별도 DB·동기화 작업 없음
- **In-Memory**: 파일을 디스크에 저장하지 않고 메모리에서 파싱 후 즉시 폐기

## 🛠 기술 스택

- Next.js 16 (App Router) + TypeScript
- Tailwind CSS v4
- googleapis (Drive API)
- xlsx (SheetJS)
- 배포: GCP Cloud Run (asia-northeast3)

## 🚀 로컬 실행

```powershell
npm install
cp .env.example .env
# .env 에 GCP_PROJECT_ID 채우기

# 인증 방법 둘 중 하나:
# (A) credentials.json 사용
#     .env에 GOOGLE_APPLICATION_CREDENTIALS=./credentials.json 추가
# (B) gcloud ADC 사용
gcloud auth application-default login

npm run dev
# http://localhost:3000
```

## ☁ 배포

자세한 배포 가이드는 `NOTION_DEPLOYMENT.md` 참조. 요약:

```powershell
.\deploy.ps1
```

## 📁 폴더 구조

```
GoogleQuery/
├── app/
│   ├── api/search/route.ts   # Drive 검색 API
│   ├── lib/drive.ts          # 검색 핵심 로직
│   ├── globals.css           # 디자인 시스템
│   ├── layout.tsx            # 루트 레이아웃
│   └── page.tsx              # 메인 UI
├── Dockerfile                # Cloud Run 컨테이너
├── cloudbuild.yaml           # Cloud Build 설정
├── deploy.ps1                # 배포 스크립트
├── .env.example              # 환경변수 템플릿
└── package.json
```
