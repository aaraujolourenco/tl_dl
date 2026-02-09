# <img src="assets/images/logo512.png" alt="TL;DL Logo" width="50" height="50" style="vertical-align: middle; margin-right: 10px;"> TL;DL - WhatsApp Voice Transcriber

**TL;DL ("Too Long; Didn't Listen")** is a Chrome Extension that automatically transcribes and summarizes WhatsApp Web voice messages. It integrates directly into the WhatsApp Web interface via a side panel, providing a seamless experience for reading voice notes instead of listening to them.

## Key Features

*   **Transcription & Summarization**: Converts voice messages to text and provides a concise "TL;DL" summary.
*   **Powered by Gemini**: Supports Google's latest models:
    *   **Gemini 3 Pro/Flash (Preview)**: Top-tier reasoning and speed.
    *   **Gemini 2.5 Flash**: Fast, intelligent, and cost-effective (Recommended).
    *   **Gemini Nano**: Runs **locally on your device** for maximum privacy (requires Chrome built-in AI).
*   **Seamless Integration**: detects voice messages in the active chat and lists them in a dedicated side panel.
*   **Search**: Instantly search through your transcribed messages.
*   **Multi-language Support**: Auto-detects or forces output in English, Portuguese, Spanish, and more.
*   **Privacy-Focused**: Your API key is stored locally. If using Gemini Nano, audio data never leaves your device.

## Installation

1.  **Clone/Download** this repository.
2.  Open Chrome and navigate to `chrome://extensions`.
3.  Enable **Developer mode** (toggle in top-right).
4.  Click **Load unpacked**.
5.  Select the `tl_dl` folder.

## Usage

1.  **Open WhatsApp Web** (`web.whatsapp.com`).
2.  Click the **TL;DL extension icon** to open the Side Panel.
3.  **Setup**:
    *   Enter your **Gemini API Key** (get one at [aistudio.google.com](https://aistudio.google.com)).
    *   Select your preferred **Model** (e.g., Gemini 2.5 Flash or Gemini Nano).
    *   Choose your **Output Language**.
4.  **Transcribe**:
    *   Open a chat with voice messages.
    *   Click "Transcribe" on any message in the side panel.
    *   Hunter Mode: The extension effectively "listens" to the audio as it plays at high speed (muted) to capture it for transcription.

## Privacy & Security

*   **API Keys**: Stored in your browser's local storage (`chrome.storage.local`). Never sent to any third-party server besides Google's AI API.
*   **Audio Data**:
    *   **Cloud Models**: Audio is sent directly to Google's Gemini API for processing and is not stored by the extension.
    *   **Local Model (Nano)**: Audio is processed entirely within your browser.

## License

This project is open-source. Feel free to modify and adapt it for your needs.
