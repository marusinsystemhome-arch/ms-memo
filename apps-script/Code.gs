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

var APP_FOLDER_NAME = "MSメモ";
var FILE_NAME = "MSメモ_データ.json";
var FOLDER_NAME = "MSメモ_添付ファイル";
var GEMINI_MODEL = "gemini-flash-latest";
var SUMMARY_PROMPT = "これは講座・セミナーの録音です。内容を聞き取り、日本語の箇条書きで要約してください。話の流れが分かるように「1. 」「2. 」「3. 」のように章立てを数字の見出しで区切り、各章の中はさらに箇条書きで具体例や数字、印象的な発言をできるだけ省略せずに盛り込んで、全体として詳しめのボリュームでまとめてください（要点だけの短い箇条書き1行ずつではなく、各項目は1〜3文程度の説明を添えてください）。前置きや「以下要約です」といった案内文は不要で、要約の本文だけを出力してください。";

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getAppFolder_() {
  var it = DriveApp.getFoldersByName(APP_FOLDER_NAME);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(APP_FOLDER_NAME);
}

function findFile_() {
  var appFolder = getAppFolder_();
  var it = appFolder.getFilesByName(FILE_NAME);
  if (it.hasNext()) return it.next();
  // 移行: 過去にMy Drive直下に保存されていたデータファイルをMSメモフォルダへ移動
  var rootIt = DriveApp.getFilesByName(FILE_NAME);
  if (rootIt.hasNext()) {
    var f = rootIt.next();
    f.moveTo(appFolder);
    return f;
  }
  return null;
}

function getOrCreateFolder_() {
  var appFolder = getAppFolder_();
  var it = appFolder.getFoldersByName(FOLDER_NAME);
  if (it.hasNext()) return it.next();
  // 移行: 過去にMy Drive直下に作られていた添付フォルダをMSメモフォルダへ移動
  var anyIt = DriveApp.getFoldersByName(FOLDER_NAME);
  if (anyIt.hasNext()) {
    var f = anyIt.next();
    f.moveTo(appFolder);
    return f;
  }
  return appFolder.createFolder(FOLDER_NAME);
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

var CHUNK_TEMP_PREFIX = "__chunk_";

// 大きい録音ファイルは1回のPOSTだと(特にモバイル回線で)途中で通信が
// 切れて失敗しやすいため、クライアント側で分割して送ってもらい、
// ここで一時ファイルとして貯めておいて最後のチャンクで結合する。
function uploadFileChunk_(uploadId, chunkIndex, totalChunks, filename, mimeType, dataBase64) {
  var folder = getOrCreateFolder_();
  var bytes = Utilities.base64Decode(dataBase64);
  var chunkName = CHUNK_TEMP_PREFIX + uploadId + "_" + chunkIndex;
  folder.createFile(Utilities.newBlob(bytes, "application/octet-stream", chunkName));

  if (chunkIndex < totalChunks - 1) {
    return { done: false };
  }

  var allBytes = [];
  for (var i = 0; i < totalChunks; i++) {
    var name = CHUNK_TEMP_PREFIX + uploadId + "_" + i;
    var it = folder.getFilesByName(name);
    if (!it.hasNext()) throw new Error("アップロードが不完全です(チャンク " + i + " が見つかりません)");
    var chunkFile = it.next();
    allBytes = allBytes.concat(chunkFile.getBlob().getBytes());
    chunkFile.setTrashed(true);
  }
  var finalFile = folder.createFile(Utilities.newBlob(allBytes, mimeType, filename));
  return { done: true, fileId: finalFile.getId() };
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
        f = getAppFolder_().createFile(FILE_NAME, text, "application/json");
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

    if (action === "uploadFileChunk") {
      var uploadId = body.uploadId;
      var chunkIndex = body.chunkIndex;
      var totalChunks = body.totalChunks;
      var chunkFilename = body.filename;
      var chunkMimeType = body.mimeType;
      var chunkDataBase64 = body.dataBase64;
      if (!uploadId || chunkIndex == null || !totalChunks || !chunkFilename || !chunkMimeType || !chunkDataBase64) {
        return jsonOutput_({ ok: false, error: "missing_params" });
      }
      var chunkResult = uploadFileChunk_(uploadId, chunkIndex, totalChunks, chunkFilename, chunkMimeType, chunkDataBase64);
      if (chunkResult.done) {
        return jsonOutput_({ ok: true, done: true, fileId: chunkResult.fileId, name: chunkFilename });
      }
      return jsonOutput_({ ok: true, done: false });
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
