// Gather element references
const button = document.getElementById("button-send-prompt");
const textarea = document.getElementById("textarea-user-prompt");
const chatMessagesElement = document.getElementById("chat-messages");

let waiting = false;
let fullMessage = "";
let latestAIMessageElement;

function escapeMath(markdown) {
    return markdown.replace(/\\\((.*?)\\\)/gs, (m, p1) => `@@MATH_INLINE_${btoa(p1)}@@`)
                   .replace(/\\\[(.*?)\\\]/gs, (m, p1) => `@@MATH_DISPLAY_${btoa(p1)}@@`);
}

function unescapeMath(html) {
    return html.replace(/@@MATH_INLINE_(.*?)@@/g, (m, p1) => `\\(${atob(p1)}\\)`)
               .replace(/@@MATH_DISPLAY_(.*?)@@/g, (m, p1) => `\\[${atob(p1)}\\]`);
}

function frontendApplyUserMessage(prompt) {
    console.log(`User prompt: ${prompt}`);

    const msgDiv = document.createElement("div");
    msgDiv.className = "chat-message chat-message-user";
    
    msgDiv.innerHTML = unescapeMath(converter.makeHtml(escapeMath(prompt)));
    chatMessagesElement.appendChild(msgDiv);
    MathJax.typeset([msgDiv]);

    waiting = true;
    button.classList.add("send-disabled");
    textarea.value = "";
    button.textContent = "Generating";
}

function frontendMakeAIMessage() {
    const msgDiv = document.createElement("div");
    msgDiv.className = "chat-message chat-message-ai";
    latestAIMessageElement = msgDiv;
}

function frontendRedoAIMessage(content) {
    const scrollTop = chatMessagesElement.scrollTop;

    latestAIMessageElement.innerHTML = unescapeMath(converter.makeHtml(escapeMath(content)));
    chatMessagesElement.appendChild(latestAIMessageElement);
    MathJax.typeset([latestAIMessageElement]);

    chatMessagesElement.scrollTop = scrollTop;
}

function frontendFinishAIMessage() {
    waiting = false;
    button.classList.remove("send-disabled");
    button.textContent = "Send";
}

// When the user clicks the Send button, push the message in the frontend
// and emit that message to the backend.
button.addEventListener("click", async function() {
    if (waiting) return;
    
    const prompt = textarea.value.trim();
    if (prompt === "") return;

    frontendApplyUserMessage(prompt);

    fullMessage = "";
    frontendMakeAIMessage();
    socket.emit("chat", prompt);
});

// The backend has responded.
socket.on("chat", (reply) => {
    frontendFinishAIMessage(fullMessage);
    console.log("Full AI response: ", reply);
});

socket.on("chunk", (chunk) => {
    if (chunk === "__pure__ :: <hr>") {
        console.log("<hr> recieved");
        fullMessage += "\n<hr>\n";
    } else {
        fullMessage += chunk;
    }

    frontendRedoAIMessage(fullMessage);
    console.log("Chunk recieved:", chunk);
});

textarea.addEventListener("input", () => {
    textarea.style.height = "auto"; // reset height
    // set height to scrollHeight but max 2 lines
    const maxHeight = 2 * parseFloat(getComputedStyle(textarea).lineHeight);
    textarea.style.height = Math.min(textarea.scrollHeight, maxHeight) + "px";
});