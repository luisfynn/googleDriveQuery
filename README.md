# 📊 Drive Price Scanner

A mobile-friendly web application that quickly searches for specific vendor and item prices across numerous Excel files stored in Google Drive.

## 🌟 Features

* **No-Database Architecture:** Utilizes Google Drive as its own database, resulting in zero maintenance costs.
* **Deep Search:** Flawlessly scans through subfolders and Shared Drives (Team Drives).
* **In-Memory Processing:** Enhances security by directly analyzing Excel files (`openpyxl`) in memory without downloading them to the server.
* **Mobile Ready:** Built with Streamlit, it is ready for immediate use on smartphones (Adding it to the Home Screen is highly recommended).

## 📋 Prerequisites

To run this app, a Google Cloud Service Account is required.

1. Enable the Google Drive API in the Google Cloud Console.
2. Create a Service Account and download the JSON key.
3. In the sharing settings of the Google Drive folder you wish to search, add the Service Account email and grant it **'Viewer'** access.

## 🚀 Deployment (Streamlit Cloud)

You can deploy this application for free on [Streamlit Community Cloud](https://share.streamlit.io/) without needing a dedicated server or Docker.

1. Fork this repository or copy it to your GitHub account.
2. Log in to Streamlit Cloud, click `New app`, and connect your repository.
3. **Important:** Before deploying, go to `Advanced settings` -> `Secrets` and input your authentication credentials in TOML format as shown below:

```toml
drive_folder_id = "YOUR_GOOGLE_DRIVE_ROOT_FOLDER_ID"

[gcp_service_account]
type = "service_account"
project_id = "your-project-id"
private_key_id = "your-private-key-id"
private_key = "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
client_email = "your-email@...gserviceaccount.com"
client_id = "..."
auth_uri = "https://accounts.google.com/o/oauth2/auth"
token_uri = "https://oauth2.googleapis.com/token"
auth_provider_x509_cert_url = "https://www.googleapis.com/oauth2/v1/certs"
client_x509_cert_url = "..."
universe_domain = "googleapis.com"

```
