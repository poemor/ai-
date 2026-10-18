document.addEventListener("DOMContentLoaded", () => {
  let config = {
    apiKey: "",
    model: "deepseek-flash",
    useContext: true,
    prompts: [
      { name: "总结页面", text: "请总结当前网页的核心要点与主要内容。" },
      { name: "解释概念", text: "请用通俗易懂的语言解释当前页面讨论的核心概念。" },
      { name: "翻译本文", text: "请将当前网页的核心要点翻译为中文。" }
    ],
    history: []
  };

  let currentImageData = null;

  const chatBox = document.getElementById("ds-chat-box");
  const textarea = document.getElementById("ds-textarea");
  const sendBtn = document.getElementById("ds-send-btn");
  const modelSelect = document.getElementById("ds-model-select");
  const useContextCb = document.getElementById("ds-use-context");
  const fileInput = document.getElementById("ds-file-input");
  const previewContainer = document.getElementById("ds-preview-container");
  const imgThumb = document.getElementById("ds-img-thumb");

  chrome.storage.local.get(["ds_config"], (result) => {
    if (result.ds_config) {
      config = { ...config, ...result.ds_config };
    }
    modelSelect.value = config.model;
    useContextCb.checked = config.useContext;
    renderPrompts();
    renderHistory();
  });

  function saveConfig() {
    chrome.storage.local.set({ ds_config: config });
  }

  modelSelect.addEventListener("change", () => {
    config.model = modelSelect.value;
    saveConfig();
  });

  useContextCb.addEventListener("change", () => {
    config.useContext = useContextCb.checked;
    saveConfig();
  });

  document.getElementById("ds-setting-btn").onclick = () => {
    let key = prompt("请输入你的 DeepSeek API Key (例如 sk-xxxx):", config.apiKey);
    if (key !== null) {
      config.apiKey = key.trim();
      saveConfig();
    }
  };

  document.getElementById("ds-clear-btn").onclick = () => {
    config.history = [];
    saveConfig();
    renderHistory();
  };

  function renderPrompts() {
    const bar = document.getElementById("ds-prompts-bar");
    bar.innerHTML = "";
    config.prompts.forEach((p) => {
      const btn = document.createElement("div");
      btn.className = "ds-prompt-tag";
      btn.innerText = p.name;
      btn.onclick = () => {
        textarea.value = p.text;
        sendMessage();
      };
      bar.appendChild(btn);
    });
  }

  function getActiveTabContext() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) return resolve("");
        chrome.tabs.sendMessage(tabs[0].id, { action: "GET_PAGE_TEXT" }, (response) => {
          if (chrome.runtime.lastError || !response) return resolve("");
          resolve(response.text || "");
        });
      });
    });
  }

  document.getElementById("ds-crop-btn").onclick = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, { action: "START_CROP" }, (response) => {
        if (chrome.runtime.lastError || !response || !response.rect) return;
        const { rect } = response;
        chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
          cropImage(dataUrl, rect, (croppedBase64) => {
            setAttachedImage(croppedBase64);
          });
        });
      });
    });
  };

  function cropImage(dataUrl, rect, callback) {
    let img = new Image();
    img.onload = () => {
      let canvas = document.createElement("canvas");
      let ctx = canvas.getContext("2d");
      let dpr = rect.pixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.drawImage(img, rect.x * dpr, rect.y * dpr, rect.width * dpr, rect.height * dpr, 0, 0, rect.width * dpr, rect.height * dpr);
      callback(canvas.toDataURL("image/png"));
    };
    img.src = dataUrl;
  }

  document.getElementById("ds-upload-btn").onclick = () => fileInput.click();
  fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => setAttachedImage(e.target.result);
      reader.readAsDataURL(file);
    }
  };

  textarea.addEventListener("paste", (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (let item of items) {
      if (item.type.indexOf("image") !== -1) {
        const file = item.getAsFile();
        const reader = new FileReader();
        reader.onload = (e) => setAttachedImage(e.target.result);
        reader.readAsDataURL(file);
        break;
      }
    }
  });

  function setAttachedImage(dataUrl) {
    currentImageData = dataUrl;
    imgThumb.src = currentImageData;
    previewContainer.style.display = "block";
    modelSelect.value = "deepseek-flash";
    config.model = "deepseek-flash";
    saveConfig();
  }

  document.getElementById("ds-img-clear").onclick = () => {
    currentImageData = null;
    previewContainer.style.display = "none";
    fileInput.value = "";
  };

  function escapeHTML(str) { return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function parseSimpleMD(text) {
    let html = escapeHTML(text);
    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    return html.replace(/\n/g, '<br>');
  }

  function renderHistory() {
    chatBox.innerHTML = "";
    if (config.history.length === 0) {
      appendBubble("ai", "你好！\n我是原生侧边栏 DeepSeek 助手，结合网页内容时后台会自动静默读取正文，界面保持清爽。");
    } else {
      config.history.forEach((msg) => {
        if (msg.role !== "system") {
          let textContent = typeof msg.content === "string" ? msg.content : (Array.isArray(msg.content) ? msg.content.find(c => c.type==='text')?.text || '' : '');
          appendBubble(msg.role === "user" ? "user" : "ai", textContent, msg.reasoning, msg.imgUrl);
        }
      });
    }
  }

  function appendBubble(role, content, reasoning, imgUrl = null) {
    const wrap = document.createElement("div");
    wrap.className = `ds-msg ${role}`;
    let innerHTML = "";
    if (role === "ai" && reasoning) {
      innerHTML += `<details class="ds-reasoning"><summary>🧠 深度思考已完成</summary><div class="ds-reasoning-content">${escapeHTML(reasoning)}</div></details>`;
    }
    let imgHtml = imgUrl ? `<img class="ds-msg-img" src="${imgUrl}">` : "";
    innerHTML += `<div class="ds-msg-bubble">${imgHtml}${parseSimpleMD(content)}</div>`;
    wrap.innerHTML = innerHTML;
    chatBox.appendChild(wrap);
    chatBox.scrollTop = chatBox.scrollHeight;
    return wrap;
  }

  async function sendMessage() {
    let text = textarea.value.trim();
    if (!text && !currentImageData) return;

    if (!config.apiKey) {
      alert("请先点击右上角 ⚙️ 设置 API Key！");
      return;
    }

    const userPromptText = text || "分析图片";
    const activeImg = currentImageData;

    textarea.value = "";
    sendBtn.disabled = true;

    currentImageData = null;
    previewContainer.style.display = "none";
    fileInput.value = "";

    // 1. 界面和历史记录中，只记录干净的用户提问
    appendBubble("user", userPromptText, null, activeImg);

    let userMessageContent;
    if (activeImg) {
      userMessageContent = [
        { type: "text", text: userPromptText },
        { type: "image_url", image_url: { url: activeImg } }
      ];
    } else {
      userMessageContent = userPromptText;
    }

    config.history.push({ role: "user", content: userMessageContent, imgUrl: activeImg });
    if (config.history.length > 12) config.history = config.history.slice(config.history.length - 12);

    // 2. 静默读取网页上下文（仅在后台提交给 API 的数据包中包含）
    let systemInstruction = "你是专业网页辅助AI，请使用Markdown格式回答。";
    if (config.useContext && !activeImg) {
      let pageContext = await getActiveTabContext();
      if (pageContext) {
        systemInstruction += `\n\n【当前用户正在浏览的网页正文内容如下】:\n${pageContext}`;
      }
    }

    const aiWrap = document.createElement("div");
    aiWrap.className = "ds-msg ai";
    const reasonDetail = document.createElement("details");
    reasonDetail.className = "ds-reasoning";
    reasonDetail.style.display = "none";
    reasonDetail.innerHTML = `<summary>🧠 正在思考...</summary><div class="ds-reasoning-content"></div>`;
    const bubble = document.createElement("div");
    bubble.className = "ds-msg-bubble";
    bubble.innerHTML = '<span class="ds-cursor"></span>';

    aiWrap.appendChild(reasonDetail);
    aiWrap.appendChild(bubble);
    chatBox.appendChild(aiWrap);
    chatBox.scrollTop = chatBox.scrollHeight;

    let accumulatedContent = "";
    let accumulatedReasoning = "";

    let payloadMsg = [{ role: "system", content: systemInstruction }];
    config.history.forEach((h) => payloadMsg.push({ role: h.role, content: h.content }));

    try {
      const response = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: config.model,
          messages: payloadMsg,
          stream: true
        })
      });

      if (!response.ok) {
        let errText = await response.text();
        bubble.innerHTML = `⚠️ 请求失败 (${response.status}): ${errText}`;
        finishStream(true);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        let lines = buffer.split("\n");
        buffer = lines.pop();

        for (let line of lines) {
          line = line.trim();
          if (line.startsWith("data: ")) {
            let dataStr = line.substring(6).trim();
            if (dataStr === "[DONE]") { finishStream(); return; }
            try {
              let data = JSON.parse(dataStr);
              let delta = data.choices[0].delta;
              if (delta.reasoning_content) {
                reasonDetail.style.display = "block";
                accumulatedReasoning += delta.reasoning_content;
                reasonDetail.querySelector(".ds-reasoning-content").innerText = accumulatedReasoning;
              }
              if (delta.content) {
                accumulatedContent += delta.content;
                bubble.innerHTML = parseSimpleMD(accumulatedContent) + '<span class="ds-cursor"></span>';
              }
              chatBox.scrollTop = chatBox.scrollHeight;
            } catch (e) {}
          }
        }
      }
      finishStream();
    } catch (err) {
      bubble.innerHTML = `⚠️ 网络错误: ${err.message}`;
      finishStream(true);
    }

    function finishStream(isError = false) {
      sendBtn.disabled = false;
      if (!isError && accumulatedContent) bubble.innerHTML = parseSimpleMD(accumulatedContent);
      if (accumulatedReasoning) {
        reasonDetail.querySelector("summary").innerText = "🧠 深度思考完成";
        reasonDetail.removeAttribute("open");
      }
      if (accumulatedContent && !isError) {
        config.history[config.history.length - 1].content = userPromptText;
        config.history.push({ role: "assistant", content: accumulatedContent, reasoning: accumulatedReasoning });
        saveConfig();
      }
    }
  }

  sendBtn.addEventListener("click", sendMessage);
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
});
