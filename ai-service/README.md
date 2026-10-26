# 4. Setup AI Service (Python + FastAPI + Uvicorn)

# Di chuyển vào thư mục ai-service và tạo môi trường ảo Python
cd ai-service
python -m venv venv

# Kích hoạt môi trường ảo (Windows)
.\venv\Scripts\activate
# (Nếu dùng macOS/Linux thì lệnh là: source venv/bin/activate)

# Cài đặt các thư viện cốt lõi cho AI & API
pip install fastapi uvicorn google-generativeai langchain chromadb pydantic requests

# Xuất danh sách thư viện ra file requirements.txt
pip freeze > requirements.txt
deactivate
cd ..
