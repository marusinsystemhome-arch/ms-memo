/**
 * Backend for MSメモ (モーニングセミナーのメモアプリ)。個人利用のみを想定しており、
 * アクセス制御は行っていない(Web App URLを知っていれば誰でも読み書きできる)。
 *
 * Deploy as a Web App:
 *   - Execute as: Me (the account that owns this script / the Drive file)
 *   - Who has access: Only myself
 *
 * Data is one JSON file (FILE_NAME) holding all entries. Audio/image
 * attachments are stored as separate Drive files inside FOLDER_NAME and
 * stay private — they are only ever served back out through this script's
 * doGet "file" action (?action=file&id=...), which streams the blob
 * directly. Nothing needs its Drive sharing changed.
 */

var FILE_NAME = "MSメモ_データ.json";
var FOLDER_NAME = "MSメモ_添付ファイル";
var GEMINI_MODEL = "gemini-2.5-flash";
var SUMMARY_PROMPT = "これは講座・セミナーの録音です。内容を聞き取り、要点を日本語の簡潔な箇条書きで要約してください。前置きや「以下要約です」といった案内文は不要で、要約の本文だけを出力してください。";

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function findFile_() {
  var it = DriveApp.getFilesByName(FILE_NAME);
  return it.hasNext() ? it.next() : null;
}

function getOrCreateFolder_() {
  var it = DriveApp.getFoldersByName(FOLDER_NAME);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(FOLDER_NAME);
}

function listRevisions_(fileId) {
  var url = "https://www.googleapis.com/drive/v3/files/" + fileId +
    "/revisions?fields=revisions(id,modifiedTime)";
  var res = UrlFetchApp.fetch(url, {
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) return [];
  var json = JSON.parse(res.getContentText());
  return json.revisions || [];
}

function getRevisionContent_(fileId, revisionId) {
  var url = "https://www.googleapis.com/drive/v3/files/" + fileId +
    "/revisions/" + encodeURIComponent(revisionId) + "?alt=media";
  var res = UrlFetchApp.fetch(url, {
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error("revision fetch failed: " + res.getResponseCode());
  }
  return JSON.parse(res.getContentText());
}

function uploadFile_(filename, mimeType, dataBase64) {
  var folder = getOrCreateFolder_();
  var bytes = Utilities.base64Decode(dataBase64);
  var blob = Utilities.newBlob(bytes, mimeType, filename);
  var file = folder.createFile(blob);
  return file.getId();
}

function summarizeAudio_(fileId) {
  var apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!apiKey) {
    throw new Error("GEMINI_API_KEYが未設定です。Apps Scriptの「プロジェクトの設定」→「スクリプト プロパティ」で設定してください。");
  }

  var file = DriveApp.getFileById(fileId);
  var blob = file.getBlob();
  var mimeType = blob.getContentType() || "audio/mp4";
  if (mimeType === "audio/x-m4a") mimeType = "audio/mp4";
  var base64 = Utilities.base64Encode(blob.getBytes());

  var url = "https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODEL +
    ":generateContent?key=" + encodeURIComponent(apiKey);
  var payload = {
    contents: [{
      parts: [
        { text: SUMMARY_PROMPT },
        { inline_data: { mime_type: mimeType, data: base64 } }
      ]
    }]
  };
  var res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var json = JSON.parse(res.getContentText());
  if (code !== 200) {
    var msg = (json.error && json.error.message) || ("Gemini APIエラー (" + code + ")");
    throw new Error(msg);
  }
  var candidate = json.candidates && json.candidates[0];
  var parts = candidate && candidate.content && candidate.content.parts;
  var text = parts ? parts.map(function (p) { return p.text || ""; }).join("") : "";
  text = text.trim();
  if (!text) throw new Error("要約結果を取得できませんでした");
  return text;
}

function doGet(e) {
  var action = e.parameter.action;

  if (action === "file") {
    try {
      var file = DriveApp.getFileById(e.parameter.id);
      return file.getBlob();
    } catch (err) {
      return ContentService.createTextOutput("not_found").setMimeType(ContentService.MimeType.TEXT);
    }
  }

  return jsonOutput_({ ok: false, error: "use_post" });
}

function doPost(e) {
  try {
    var body = {};
    if (e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }
    var action = body.action;

    if (action === "load") {
      var file = findFile_();
      if (!file) return jsonOutput_({ ok: true, exists: false });
      var content = JSON.parse(file.getBlob().getDataAsString("UTF-8"));
      return jsonOutput_({
        ok: true,
        exists: true,
        fileId: file.getId(),
        modifiedTime: file.getLastUpdated().toISOString(),
        content: content,
        revisions: listRevisions_(file.getId())
      });
    }

    if (action === "save") {
      var payload = body.payload;
      if (!payload) return jsonOutput_({ ok: false, error: "missing_payload" });
      var text = JSON.stringify(payload);
      var f = findFile_();
      if (f) {
        f.setContent(text);
      } else {
        f = DriveApp.createFile(FILE_NAME, text, "application/json");
      }
      return jsonOutput_({ ok: true, fileId: f.getId(), modifiedTime: new Date().toISOString() });
    }

    if (action === "loadRevision") {
      var fileId = body.fileId;
      var revisionId = body.revisionId;
      if (!fileId || !revisionId) return jsonOutput_({ ok: false, error: "missing_params" });
      var revContent = getRevisionContent_(fileId, revisionId);
      return jsonOutput_({ ok: true, content: revContent });
    }

    if (action === "uploadFile") {
      var filename = body.filename;
      var mimeType = body.mimeType;
      var dataBase64 = body.dataBase64;
      if (!filename || !mimeType || !dataBase64) {
        return jsonOutput_({ ok: false, error: "missing_params" });
      }
      var fileId = uploadFile_(filename, mimeType, dataBase64);
      return jsonOutput_({ ok: true, fileId: fileId, name: filename });
    }

    if (action === "summarizeAudio") {
      var summaryFileId = body.fileId;
      if (!summaryFileId) return jsonOutput_({ ok: false, error: "missing_params" });
      var summary = summarizeAudio_(summaryFileId);
      return jsonOutput_({ ok: true, summary: summary });
    }

    return jsonOutput_({ ok: false, error: "unknown_action" });
  } catch (err) {
    return jsonOutput_({ ok: false, error: "server_error", message: String(err && err.message || err) });
  }
}
