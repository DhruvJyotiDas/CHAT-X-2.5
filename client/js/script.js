let socket;
let username;
let authToken;
let selectedRecipient = null;
let localStream;
let peerConnection;
let room;
let callInProgress = false;
let caller = null;
let incomingCallType = 'video';
let outboundCallType = 'video';
let amInitiator = false;

const configuration = {
  iceServers: [
    {
      urls: "turn:vc.4rc.in:3478",
      username: "admin",
      credential: "password123"
    }
  ],
  iceTransportPolicy: "relay"
};





const userIcons = ['images/bot-icon.png', 'images/group-icon.png'];

// DOM Elements
const incomingCallPopup = document.getElementById("incoming-call-popup");
const incomingCallText = document.getElementById("incoming-call-text");
const acceptCallBtn = document.getElementById("accept-call-btn");
const declineCallBtn = document.getElementById("decline-call-btn");
const outgoingCallPopup = document.getElementById("outgoing-call-popup");
const outgoingCallText = document.getElementById("outgoing-call-text");
const cancelCallBtn = document.getElementById("cancel-call-btn");
const videoCallUI = document.querySelector(".video-call-ui");
const localVideo = document.getElementById("local-video");
const remoteVideo = document.getElementById("remote-video");
const endCallBtn = document.getElementById("end-call-btn");

console.log("✅ script.js loaded!");

// Emoji Picker
const emojiPicker = document.createElement("div");
emojiPicker.id = "emoji-picker";
emojiPicker.style.position = "absolute";
emojiPicker.style.background = "#fff";
emojiPicker.style.border = "1px solid #ccc";
emojiPicker.style.padding = "5px";
emojiPicker.style.borderRadius = "5px";
emojiPicker.style.display = "none";
emojiPicker.style.zIndex = "1000";
document.body.appendChild(emojiPicker);

const emojis = ["😀", "😂", "😍", "😢", "😠", "😐", "👍", "🙏", "🎉", "❤️", "😎", "🤔"];
emojis.forEach(emoji => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = emoji;
    btn.style.fontSize = "20px";
    btn.style.margin = "2px";
    btn.style.border = "none";
    btn.style.background = "transparent";
    btn.style.cursor = "pointer";
    btn.addEventListener("click", () => {
        messageInput.value += emoji;
        messageInput.focus();
        emojiPicker.style.display = "none";
    });
    emojiPicker.appendChild(btn);
});

const emojiBtn = document.getElementById("emoji-btn");
emojiBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const rect = emojiBtn.getBoundingClientRect();
    emojiPicker.style.left = `${rect.left}px`;
    emojiPicker.style.top = `${rect.top - emojiPicker.offsetHeight - 10}px`;
    emojiPicker.style.display = emojiPicker.style.display === "none" ? "block" : "none";
});
document.addEventListener("click", () => emojiPicker.style.display = "none");

const API_BASE_URL = window.location.origin;


window.onload = async function() {
    username = sessionStorage.getItem("username");
    const password = sessionStorage.getItem("password");

    if (!username || !password) {
        alert("Login info not found. Redirecting to login page.");
        window.location.href = "login.html";
        return;
    }

    document.querySelector(".welcome").textContent = `Welcome, ${username}`;

    try {
        const res = await fetch(`${API_BASE_URL}/login`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                username,
                password
            }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Login failed");

        authToken = data.token || "dummy-token";
        connectSocketIO();
    } catch (err) {
        alert("Login failed or session expired.");
        window.location.href = "login.html";
    }
};

function connectSocketIO() {
    console.log("[WebRTC CLIENT] Connecting to:", API_BASE_URL);
    socket = io(API_BASE_URL, {
        path: "/socket.io"
    });

    // Initially disable call buttons
    document.getElementById('voice-call-btn').disabled = true;
    document.getElementById('video-call-btn').disabled = true;

    socket.on("connect", () => {
        console.log(`[WebRTC CLIENT] SUCCESS: socket connected. SocketID: ${socket.id}`);
        console.log(`[WebRTC CLIENT] Emitting connect-user. Username: ${username}`);
        socket.emit("connect-user", {
            username
        });
    });

    socket.on("error", (error) => {
        console.error(`[WebRTC CLIENT] FAIL: Socket.IO error:`, error);
        if (typeof error === 'string' && error.toLowerCase().includes("spam")) {
            showNotification("Spam detected: Your message was blocked.");
        } else {
            alert("Socket.IO error.");
        }
    });

    socket.on("disconnect", (reason) => console.warn(`[WebRTC CLIENT] Socket disconnected. Reason: ${reason}`));

    socket.on("updateUsers", (users) => {
        // ... user update logic ...
        const userGrid = document.getElementById('user-grid');
        const userCardTemplate = document.getElementById('user-card-template');
        userGrid.innerHTML = ""; // Clear existing users
        users.forEach(user => {
            if (user !== username) {
                const card = userCardTemplate.content.cloneNode(true);
                card.querySelector('.user-name').textContent = user;
                // Randomize user icon
                const randomIcon = userIcons[Math.floor(Math.random() * userIcons.length)];
                card.querySelector('.user-icon').src = randomIcon;

                card.querySelector('.user-card').onclick = async () => {
                    selectedRecipient = user;
                    document.getElementById('chat-title').textContent = `Chat with ${user}`;
                    document.getElementById('chat-box').innerHTML = "";
                    
                    // Enable call buttons
                    document.getElementById('voice-call-btn').disabled = false;
                    document.getElementById('video-call-btn').disabled = false;

                    // Fetch chat history
                    const res = await fetch(`${API_BASE_URL}/history?user=${username}&peer=${user}`);
                    const messages = await res.json();
                    messages.forEach(renderMessage);

                    document.getElementById('chat-modal').classList.remove('hidden');
                };
                userGrid.appendChild(card);
            }
        });
    });

    document.getElementById('close-chat-btn').onclick = () => {
        document.getElementById('chat-modal').classList.add('hidden');
        selectedRecipient = null;
        // Disable call buttons when chat is closed
        document.getElementById('voice-call-btn').disabled = true;
        document.getElementById('video-call-btn').disabled = true;
    };

    socket.on("call-offer-ack", (data) => {
        console.log(`[WebRTC CLIENT] SUCCESS: call-offer ACK received. Data:`, data);
    });

    socket.on("call-offer", ({ from, type }) => {
        console.log(`[WebRTC CLIENT] SUCCESS: call-offer received. From: ${from}, Type: ${type}`);
        incomingCallType = type;

        if (callInProgress) {
            console.warn(`[WebRTC CLIENT] FAIL: Call already in progress. Rejecting.`);
            socket.emit("call-rejected", { to: from, reason: "busy" });
            return;
        }

        caller = from;
        incomingCallText.textContent = `${from} is calling you for a ${type} call.`;
        incomingCallPopup.classList.remove("hidden");
    });


    socket.on("call-accepted", async ({ from }) => {
        console.log(`[WebRTC CLIENT] SUCCESS: call-accepted received. From: ${from}`);
        outgoingCallPopup.classList.add("hidden");
        if (selectedRecipient === from) {
            await startWebRTCCall(outboundCallType, true); // isInitiator = true
        } else {
             console.warn(`[WebRTC CLIENT] FAIL: Unexpected call-accepted from: ${from}`);
        }
    });

    socket.on("call-rejected", ({ reason }) => {
        console.log(`[WebRTC CLIENT] FAIL: Call rejected. Reason: ${reason}`);
        outgoingCallPopup.classList.add("hidden");
        showNotification(`Call rejected: ${reason}`);
        endCall();
    });

    socket.on("call-ended", () => {
        console.log(`[WebRTC CLIENT] SUCCESS: Call ended by remote peer.`);
        endCall();
    });






    socket.on("room-joined", async ({ numClients }) => {
        console.log(`[WebRTC CLIENT] room-joined: ${numClients}`);

        if (amInitiator && numClients === 2) {
            console.log("[WebRTC CLIENT] Creating OFFER (single path)");

            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);

            socket.emit("signal", {
            signal: { type: "offer", sdp: offer },
            room
            });
        }
        });


    socket.on("signal", async ({
        signal
    }) => {
        if (!peerConnection) {
             console.error(`[WebRTC CLIENT] FAIL: Received signal but peerConnection is NULL.`);
             return;
        }
        const type = signal.type || (signal.candidate ? "candidate" : "unknown");
        console.log(`[WebRTC CLIENT] SUCCESS: signal received. Type: ${type}`);
        
        if (signal.type === "offer") {
            console.log(`[WebRTC CLIENT] SUCCESS: offer received.`);
            await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
            
            console.log(`[WebRTC CLIENT] Creating ANSWER...`);
            const answer = await peerConnection.createAnswer();
            console.log(`[WebRTC CLIENT] SUCCESS: answer created.`);
            await peerConnection.setLocalDescription(answer);
            
            console.log(`[WebRTC CLIENT] SUCCESS: answer sent.`);
            socket.emit("signal", {
                signal: {
                    type: "answer",
                    sdp: answer
                },
                room
            });
        } else if (signal.type === "answer") {
            console.log(`[WebRTC CLIENT] SUCCESS: answer received.`);
            await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        } else if (signal.candidate) {
            console.log(`[WebRTC CLIENT] SUCCESS: ICE candidate received.`);
            await peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
        }
    });


    socket.on("message", (data) => {
        updateEmoji(data.mood);
        renderMessage(data);
    });

    socket.on("typing", (data) => {
        showTypingIndicator(data.sender);
        updateEmoji("neutral");
    });
}

async function startWebRTCCall(callType, isInitiator = true) {
    console.log(`[WebRTC CLIENT] startWebRTCCall() STARTED. Type: ${callType}, Initiator: ${isInitiator}`);
    try {
        callInProgress = true;
        amInitiator = isInitiator;
        const recipient = isInitiator ? selectedRecipient : caller;
        document.getElementById('local-video-username').textContent = username;
        document.getElementById('remote-video-username').textContent = recipient;

        const constraints = {
            video: callType === 'video',
            audio: true
        };
        console.log("[WebRTC CLIENT] Requesting getUserMedia...");
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log("[WebRTC CLIENT] SUCCESS: getUserMedia stream obtained. ID:", localStream.id);
        localVideo.srcObject = localStream;

        console.log("[WebRTC CLIENT] Creating RTCPeerConnection...");
        peerConnection = new RTCPeerConnection(configuration);
        window.pc = peerConnection;

        console.log("[WebRTC CLIENT] Adding local tracks to PeerConnection...");
        localStream.getTracks().forEach(track => {
            console.log(`[WebRTC CLIENT] Added track: ${track.kind}`);
            peerConnection.addTrack(track, localStream);
        });

        peerConnection.ontrack = (event) => {
            console.log("[WebRTC CLIENT] ontrack fired", event.streams);

            const stream = event.streams[0];

            if (!remoteVideo.srcObject) {
                    remoteVideo.srcObject = stream;

                    // 🔑 CRITICAL browser requirements
                    remoteVideo.autoplay = true;
                    remoteVideo.playsInline = true;
                    remoteVideo.muted = true; // REQUIRED to allow autoplay

                    // Force play
                    remoteVideo
                    .play()
                    .then(() => {
                        console.log("[WebRTC CLIENT] Remote video playing");
                    })
                    .catch(err => {
                        console.error("[WebRTC CLIENT] Remote video play failed", err);
                    });
                }
                };


        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log(`[WebRTC CLIENT] SUCCESS: ICE candidate generated.`);
                console.log(`[WebRTC CLIENT] ICE candidate sent.`);
                socket.emit("signal", {
                    signal: { candidate: event.candidate },
                    room
                });
            } else {
                console.log("[WebRTC CLIENT] End of ICE candidates.");
            }
        };
        
        peerConnection.oniceconnectionstatechange = () => {
             console.log(`[WebRTC CLIENT] STATE CHANGE: iceConnectionState: ${peerConnection.iceConnectionState}`);
        };
        
        peerConnection.onconnectionstatechange = () => {
             console.log(`[WebRTC CLIENT] STATE CHANGE: connectionState: ${peerConnection.connectionState}`);
        };
        
        peerConnection.onsignalingstatechange = () => {
             console.log(`[WebRTC CLIENT] STATE CHANGE: signalingState: ${peerConnection.signalingState}`);
        };

        room = [username, recipient].sort().join("-");
        console.log(`[WebRTC CLIENT] Emitting join-room. Room: ${room}, Initiator: ${isInitiator}`);
        socket.emit("join-room", { room, initiator: isInitiator });


        videoCallUI.classList.remove("hidden");
    } catch (err) {
        console.error("[WebRTC CLIENT] FAIL: startWebRTCCall error:", err);
        alert("Failed to start video call: " + err.message);
        callInProgress = false;
        videoCallUI.classList.add("hidden");
    }
}

function endCall() {
    if (peerConnection) peerConnection.close();
    peerConnection = null;
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    videoCallUI.classList.add("hidden");
    callInProgress = false;
    caller = null;
}

endCallBtn.addEventListener("click", () => {
    const recipient = selectedRecipient || caller;
    if (recipient) {
        socket.emit("call-ended", { to: recipient });
    }
    endCall();
});


acceptCallBtn.addEventListener("click", async () => {
    incomingCallPopup.classList.add("hidden");
    selectedRecipient = caller;
    socket.emit("call-accepted", { to: caller });
    await startWebRTCCall(incomingCallType, false); // isInitiator = false
});

declineCallBtn.addEventListener("click", () => {
    incomingCallPopup.classList.add("hidden");
    socket.emit("call-rejected", { to: caller, reason: "declined" });
    caller = null;
});

cancelCallBtn.addEventListener("click", () => {
    outgoingCallPopup.classList.add("hidden");
    if (selectedRecipient) {
        socket.emit("call-ended", { to: selectedRecipient });
    }
    callInProgress = false;
});

// Mute button functionality
const muteBtn = document.getElementById("mute-btn");
let isMuted = false;

muteBtn.addEventListener("click", () => {
    if (!localStream) return;
    isMuted = !isMuted;
    localStream.getAudioTracks().forEach(track => {
        track.enabled = !isMuted;
    });
    // Toggle icon/style based on mute state
    if (isMuted) {
         muteBtn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>';
         muteBtn.classList.add('muted');
    } else {
         muteBtn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>';
         muteBtn.classList.remove('muted');
    }
});

// Minimize/Maximize functionality
const minimizeBtn = document.getElementById("minimize-video-btn");
minimizeBtn.addEventListener("click", (e) => {
    e.stopPropagation(); // Prevent drag start
    videoCallUI.classList.toggle("minimized");
    if (videoCallUI.classList.contains("minimized")) {
        minimizeBtn.textContent = "□";
        minimizeBtn.title = "Maximize";
    } else {
        minimizeBtn.textContent = "_";
        minimizeBtn.title = "Minimize";
        // Reset position when maximizing if needed, or keep it floating
        // videoCallUI.style.top = "50%";
        // videoCallUI.style.left = "50%";
        // videoCallUI.style.transform = "translate(-50%, -50%)";
    }
});


// Draggable video call UI (Handle only on Header)
const videoHeader = document.getElementById("video-header");
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let initialX = 0;
let initialY = 0;

videoHeader.addEventListener("mousedown", (e) => {
    if (videoCallUI.classList.contains("minimized")) return; // Disable drag when minimized (fixed position)
    
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    
    // Calculate current position relative to viewport
    const rect = videoCallUI.getBoundingClientRect();
    initialX = rect.left;
    initialY = rect.top;
    
    videoCallUI.style.transition = "none";
    videoCallUI.style.transform = "none"; // Remove translate to use raw top/left
});

document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    const deltaX = e.clientX - dragStartX;
    const deltaY = e.clientY - dragStartY;
    
    videoCallUI.style.left = (initialX + deltaX) + "px";
    videoCallUI.style.top = (initialY + deltaY) + "px";
});

document.addEventListener("mouseup", () => {
    if (isDragging) {
        isDragging = false;
        videoCallUI.style.transition = "";
    }
});


function initiateCall(callType) {
    outboundCallType = callType;
    console.log(`[WebRTC Log] 4. initiateCall() CALLED. Type: ${callType}`);
    console.log(`[WebRTC Log] Target Recipient: ${selectedRecipient}`);
    
    if (!selectedRecipient) return showNotification("Select a user first.");
    if (callInProgress) return showNotification("Another call is already in progress.");

    socket.emit("call-offer", {
        to: selectedRecipient,
        from: username,
        type: callType
    });

    outgoingCallText.textContent = `Calling ${selectedRecipient}...`;
    outgoingCallPopup.classList.remove("hidden");

    console.log("[WebRTC Log] 4a. call-offer EMITTED to server");
}

document.getElementById('voice-call-btn').onclick = () => {
    console.log('Voice call button clicked');
    initiateCall('audio');
};
document.getElementById('video-call-btn').onclick = () => {
    console.log('Video call button clicked');
    initiateCall('video');
};


function updateEmoji(mood) {
    const emojiMap = {
        happy: "😄",
        sad: "😢",
        angry: "😠",
        neutral: "😐"
    };
    document.getElementById("live-emoji").textContent = emojiMap[mood] || "😐";
}

function showTypingIndicator(sender) {
    const id = `typing-${sender}`;
    if (document.getElementById(id)) return;
    const el = document.createElement("div");
    el.id = id;
    el.className = "message status";
    el.textContent = `${sender} is typing...`;
    document.getElementById("chat-box").appendChild(el);
    setTimeout(() => document.getElementById(id)?.remove(), 3000);
}

const sendBtn = document.getElementById("send-btn");
const messageInput = document.getElementById("message");

sendBtn?.addEventListener("click", () => {
    const msg = messageInput.value.trim();
    if (!msg || !selectedRecipient) return;
    const payload = {
        type: "message",
        sender: username,
        recipient: selectedRecipient,
        message: msg,
        timestamp: Date.now()
    };
    socket.emit("message", payload);
    renderMessage(payload);
messageInput.value = "";
});

messageInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendBtn.click();
    else if (selectedRecipient) {
        socket.emit("typing", {
            sender: username,
            recipient: selectedRecipient
        });
    }
});

function renderMessage({
    sender,
    message,
    timestamp
}) {
    const templateId = sender === username ? "message-template-sent" : "message-template-received";
    const template = document.getElementById(templateId);
    const clone = template.content.cloneNode(true);
    const contentEl = clone.querySelector(".content");
    contentEl.textContent = message;
    if (sender !== username) clone.querySelector(".sender").textContent = sender;
    const time = new Date(timestamp || Date.now()).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    });
    clone.querySelector(".meta").textContent = time;
    const box = document.getElementById("chat-box");
    box.appendChild(clone);
    box.scrollTop = box.scrollHeight;
}

function showNotification(message) {
    const container = document.getElementById("notification-container");
    if (!container) return;
    const notification = document.createElement("div");
    notification.className = "notification";
    notification.textContent = message;
    container.appendChild(notification);
    setTimeout(() => notification.classList.add("hide"), 2000);
    setTimeout(() => container.removeChild(notification), 3000);
}