# UTF-8 인코딩 (한글 깨짐 방지)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null

# ────────────────────────────────────────────────────────────────
# GoogleQuery (Next.js) Google Cloud 배포 스크립트
# web3platform 패턴 참조 - Cloud Build → Artifact Registry → Cloud Run
# ────────────────────────────────────────────────────────────────

# .env 로드
if (Test-Path ".env") {
    Get-Content .env | Foreach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#")) {
            $name, $value = $line -split '=', 2
            Set-Content "env:$($name.Trim())" ($value.Trim())
        }
    }
    Write-Host "✅ .env 파일 로드 완료" -ForegroundColor Green
} else {
    Write-Host "❌ .env 파일을 찾을 수 없습니다. .env.example 참고하세요." -ForegroundColor Red
    exit
}

$PROJ_ID = $env:GCP_PROJECT_ID

if (-not $PROJ_ID) {
    Write-Host "❌ GCP_PROJECT_ID 누락" -ForegroundColor Red; exit
}

# credentials.json의 서비스 계정 이메일 자동 추출
# Cloud Run을 이 SA로 실행 시켜서 기존 Drive 권한 그대로 재사용
$SA_EMAIL = $null
if (Test-Path "credentials.json") {
    try {
        $sa = Get-Content "credentials.json" -Raw | ConvertFrom-Json
        $SA_EMAIL = $sa.client_email
        Write-Host "✅ 서비스 계정: $SA_EMAIL" -ForegroundColor Green
    } catch {
        Write-Host "⚠️ credentials.json 파싱 실패 - 기본 Compute SA로 배포" -ForegroundColor Yellow
    }
} else {
    Write-Host "⚠️ credentials.json 없음 - 기본 Compute SA로 배포" -ForegroundColor Yellow
}

# ────────────────────────────────────────────────────────────────
# GCP 설정
# ────────────────────────────────────────────────────────────────
$REGION       = "asia-northeast3"
$REPO_NAME    = "googlequery-repo"
$SERVICE_NAME = "googlequery-service"
$IMAGE_PATH   = "$REGION-docker.pkg.dev/$PROJ_ID/$REPO_NAME/nextjs-app"

Write-Host ""
Write-Host "📋 배포 설정" -ForegroundColor Cyan
Write-Host "   프로젝트  : $PROJ_ID"
Write-Host "   리전      : $REGION"
Write-Host "   이미지    : $IMAGE_PATH"
Write-Host ""

# 0. Artifact Registry 확인
Write-Host "🗂  0단계: Artifact Registry 확인..." -ForegroundColor Cyan
& gcloud artifacts repositories describe $REPO_NAME --location=$REGION --project=$PROJ_ID 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "   레포지토리 없음 → 생성 중..." -ForegroundColor Yellow
    & gcloud artifacts repositories create $REPO_NAME `
        --repository-format=docker `
        --location=$REGION `
        --project=$PROJ_ID
}
Write-Host "✅ Artifact Registry 준비 완료" -ForegroundColor Green

# 1. 이미지 빌드
Write-Host ""
Write-Host "🔨 1단계: 이미지 빌드 중..." -ForegroundColor Cyan
$buildArgs = @(
    "builds", "submit",
    "--config", "cloudbuild.yaml",
    "--substitutions", "_IMAGE_PATH=$IMAGE_PATH",
    "--project", $PROJ_ID,
    "."
)
& gcloud @buildArgs
if ($LASTEXITCODE -ne 0) { Write-Host "❌ 빌드 실패" -ForegroundColor Red; exit }
Write-Host "✅ 빌드 완료" -ForegroundColor Green

# 2. Cloud Run 배포
Write-Host ""
Write-Host "🚀 2단계: Cloud Run 배포 중..." -ForegroundColor Cyan
$deployArgs = @(
    "run", "deploy", $SERVICE_NAME,
    "--image", $IMAGE_PATH,
    "--region", $REGION,
    "--project", $PROJ_ID,
    "--allow-unauthenticated",
    "--port", "8080"
)
if ($SA_EMAIL) {
    $deployArgs += @("--service-account", $SA_EMAIL)
}
& gcloud @deployArgs
if ($LASTEXITCODE -ne 0) { Write-Host "❌ 배포 실패" -ForegroundColor Red; exit }

# URL 출력
$url = & gcloud run services describe $SERVICE_NAME `
    --region $REGION --project $PROJ_ID --format "value(status.url)"

Write-Host ""
Write-Host "════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "✅ 배포 완료!" -ForegroundColor Green
Write-Host "🌐 URL: $url" -ForegroundColor Green
Write-Host "════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "💡 컨테이너 상시 유지 원하면 Cloud Run 콘솔에서" -ForegroundColor Cyan
Write-Host "   $SERVICE_NAME → 인스턴스 → '최소 인스턴스' 를 1로 설정" -ForegroundColor Cyan
