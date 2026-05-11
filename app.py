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

# 3. 직관적인 2단계 검색 UI
st.subheader("🔍 상세 단가 검색")
col1, col2 = st.columns(2)
search_file = col1.text_input("📁 업체/파일명 (예: 선진)")
search_item = col2.text_input("📦 찾을 품목 (예: pa 화이트)")

if st.button("데이터 검색하기"):
    if not search_file or not search_item:
        st.warning("업체명과 품목명을 모두 입력해 주세요.")
    else:
        with st.spinner(f"'{search_file}' 관련 파일에서 '{search_item}' 단가를 찾는 중입니다..."):
            
            FOLDER_ID = st.secrets["drive_folder_id"]
            
            # 1. 파일 이름에 '선진'이 들어간 모든 파일 검색
            results = service.files().list(
                # FOLDER_ID 조건을 빼서 하위 폴더까지 재귀적으로 싹 다 뒤지게 만듦
                # 폴더 자체가 엑셀로 인식되는 것을 막기 위해 mimeType 조건 추가
                q=f"name contains '{search_file}' and mimeType != 'application/vnd.google-apps.folder' and trashed = false",
                fields="files(id, name)",
                pageSize=1000,                  # 한 번에 최대 검색량을 100개(기본값)에서 1000개로 늘림
                supportsAllDrives=True,         # 공유(팀) 드라이브 지원
                includeItemsFromAllDrives=True  # 모든 드라이브 항목 포함
            ).execute()
            items = results.get('files', [])

            if not items:
                st.error(f"'{search_file}'(이)가 포함된 엑셀 파일이 드라이브에 없습니다.")
            else:
                found_data = False
                
                # 2. 찾은 파일들을 하나씩 열어서 내부 데이터 뒤지기
                for file_info in items:
                    try:
                        # 파일 다운로드 (메모리 로드)
                        file_id = file_info['id']
                        request = service.files().get_media(fileId=file_id)
                        file_io = io.BytesIO()
                        downloader = MediaIoBaseDownload(file_io, request)
                        
                        done = False
                        while done is False:
                            status, done = downloader.next_chunk()
                        file_io.seek(0)
                        
                        # 엑셀 파일 읽기
                        df = pd.read_excel(file_io, engine='openpyxl')
                        
                        # 3. 엑셀 내부의 모든 셀을 대상으로 품목명('pa 화이트') 검색
                        # 모든 데이터를 문자열로 변환 후 대소문자 무시하고 검색
                        mask = df.astype(str).apply(lambda x: x.str.contains(search_item, case=False, na=False))
                        matching_rows = df[mask.any(axis=1)]
                        
                        # 검색 결과가 있다면 화면에 출력
                        if not matching_rows.empty:
                            found_data = True
                            st.success(f"✅ 문서 발견: **{file_info['name']}**")
                            
                            # 💡 엑셀에서 찾은 해당 행(Row)의 데이터를 통째로 표로 보여줍니다.
                            st.dataframe(matching_rows, use_container_width=True)
                            
                            # (주의) 여기서 그래프를 그리려면 엑셀의 몇 번째 열이 '날짜'이고 
                            # 몇 번째 열이 '가격'인지 코드가 정확히 알아야 합니다.
                            
                    except Exception as e:
                        pass # 읽기 실패한 파일은 건너뜀
                        
                if not found_data:
                    st.warning(f"파일은 찾았지만, 문서 안에 '{search_item}' 데이터가 없습니다.")