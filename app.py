import streamlit as st
import pandas as pd
import plotly.express as px
import io
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from google.oauth2 import service_account

# 1. UI 설정
st.set_page_config(page_title="단가 검색기", layout="centered")
st.title("📊 5년 트렌드 단가 검색기")
st.caption("누구나 쉽게 원자재/품목의 최근 5년 가격 추이를 확인하세요.")

# 2. 구글 인증 (보안 금고인 st.secrets에서 키를 가져옴)
@st.cache_resource
def get_drive_service():
    creds_dict = st.secrets["gcp_service_account"]
    creds = service_account.Credentials.from_service_account_info(
        creds_dict, scopes=['https://www.googleapis.com/auth/drive.readonly']
    )
    return build('drive', 'v3', credentials=creds)

try:
    service = get_drive_service()
except Exception as e:
    st.error("시스템 설정 중입니다. 잠시 후 다시 시도해주세요.")
    st.stop()

# 3. 검색창 및 결과 출력
query = st.chat_input("검색할 품목명을 입력하세요 (예: 2026년_강판)")

if query:
    with st.spinner("데이터베이스를 스캔 중입니다..."):
        # 드라이브에서 파일 검색
		FOLDER_ID = st.secrets["drive_folder_id"]
		
		# 드라이브에서 특정 폴더 내 파일만 검색
        results = service.files().list(
            q=f"'{FOLDER_ID}' in parents and name contains '{query}' and trashed = false",
            fields="files(id, name)"
        ).execute()
        items = results.get('files', [])

        if not items:
            st.warning("일치하는 데이터가 없습니다. 다른 검색어를 입력해보세요.")
        else:
            try:
                # 파일 다운로드 (메모리에서 처리하여 서버에 흔적을 남기지 않음)
                file_id = items[0]['id']
                request = service.files().get_media(fileId=file_id)
                file_io = io.BytesIO()
                downloader = MediaIoBaseDownload(file_io, request)
                
                done = False
                while done is False:
                    status, done = downloader.next_chunk()
                
                file_io.seek(0)
                
                # xlsm 엑셀 파일 읽기 (실제 시트명으로 변경 필요할 수 있음)
                df = pd.read_excel(file_io, engine='openpyxl', sheet_name='Sheet1')
                
                year_col = df.columns[0]
                price_col = df.columns[1]
                current_price = df[price_col].iloc[-1]
                
                # 결과 출력
                st.success(f"✅ '{items[0]['name']}' 분석 완료")
                st.metric(label="최근 단가", value=f"{current_price:,.0f}원")
                
                fig = px.line(df, x=year_col, y=price_col, title="최근 가격 추이")
                st.plotly_chart(fig, use_container_width=True)
                
            except Exception as e:
                st.error("데이터를 불러오는 데 실패했습니다.")