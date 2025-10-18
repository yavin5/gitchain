import { i as initP2P, g as getLibp2p, f as fetchState, s as saveGithubAccessToken, p as processTxns, v as viewChain, a as getServerPeers } from "./bundle.js";
document.addEventListener("DOMContentLoaded", async () => {
  console.log("DOMContentLoaded triggered");
  try {
    const isServer = localStorage.getItem("gitchain_github_access_token") !== null;
    console.log("isServer:", isServer);
    await initP2P(isServer);
    const libp2p = getLibp2p();
    if (!libp2p) {
      console.error("libp2p initialization failed");
      document.getElementById("token-message").textContent = "Error: Failed to initialize P2P network";
      return;
    }
    const peerIdDisplay = document.getElementById("peer-id");
    const messageInput = document.getElementById("message-input");
    const sendButton = document.getElementById("send-message");
    const messagesDiv = document.getElementById("messages");
    const processTxnsButton = document.getElementById("process-txns");
    const blockHeightDiv = document.getElementById("block-height");
    const saveTokenButton = document.getElementById("save-token");
    const tokenMessage = document.getElementById("token-message");
    if (libp2p && libp2p.peerId) {
      const shortPeerId = libp2p.peerId.toString().slice(-8);
      peerIdDisplay.textContent = shortPeerId;
      console.log("Peer ID displayed:", shortPeerId);
    } else {
      console.error("Failed to display peer ID: libp2p or peerId not available");
      peerIdDisplay.textContent = "Error: Peer ID unavailable";
    }
    const stateData = await fetchState();
    if (stateData) {
      blockHeightDiv.textContent = `Block Height: ${stateData.content.chain.length}`;
      console.log("Block height set:", stateData.content.chain.length);
    } else {
      console.error("Failed to fetch state");
      blockHeightDiv.textContent = "Error: Failed to fetch state";
    }
    processTxnsButton.classList.toggle("hidden", !isServer);
    console.log("Process Transactions button visibility:", !processTxnsButton.classList.contains("hidden"));
    if (libp2p && libp2p.services.pubsub) {
      try {
        await libp2p.services.pubsub.subscribe("gitchain-chat");
        console.log("Subscribed to gitchain-chat");
        libp2p.services.pubsub.addEventListener("message", (evt) => {
          if (evt.detail.topic === "gitchain-chat") {
            const message = new TextDecoder().decode(evt.detail.data);
            const senderId = evt.detail.from.toString().slice(-8);
            const messageElement = document.createElement("p");
            messageElement.textContent = `${senderId}: ${message}`;
            messagesDiv.appendChild(messageElement);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
            console.log("Received message:", { senderId, message });
          }
        });
      } catch (error) {
        console.error("Failed to subscribe to gitchain-chat:", error);
        messagesDiv.appendChild(document.createElement("p")).textContent = "Error: Failed to subscribe to chat";
      }
    } else {
      console.error("Pubsub service not available");
      messagesDiv.appendChild(document.createElement("p")).textContent = "Error: Pubsub unavailable";
    }
    sendButton.addEventListener("click", async () => {
      console.log("Send button clicked");
      const message = messageInput.value.trim();
      if (message && libp2p && libp2p.services.pubsub) {
        try {
          await libp2p.services.pubsub.publish("gitchain-chat", new TextEncoder().encode(message));
          console.log("Published message:", message);
          const shortPeerId = libp2p.peerId.toString().slice(-8);
          const messageElement = document.createElement("p");
          messageElement.textContent = `${shortPeerId}: ${message}`;
          messagesDiv.appendChild(messageElement);
          messagesDiv.scrollTop = messagesDiv.scrollHeight;
          messageInput.value = "";
        } catch (error) {
          console.error("Failed to publish message:", error);
          messagesDiv.appendChild(document.createElement("p")).textContent = "Error: Failed to send message";
        }
      } else {
        console.error("Cannot send message: libp2p or pubsub not available or empty message");
        messagesDiv.appendChild(document.createElement("p")).textContent = "Error: Cannot send message";
      }
    });
    saveTokenButton.addEventListener("click", async () => {
      console.log("Save token button clicked");
      try {
        saveGithubAccessToken();
        tokenMessage.textContent = "Token saved successfully";
        console.log("Token saved, re-initializing P2P as host");
        await initP2P(true);
        const newLibp2p = getLibp2p();
        if (newLibp2p && newLibp2p.peerId) {
          const shortPeerId = newLibp2p.peerId.toString().slice(-8);
          peerIdDisplay.textContent = shortPeerId;
          console.log("Peer ID updated after PAT save:", shortPeerId);
        } else {
          console.error("Failed to update peer ID after PAT save");
          peerIdDisplay.textContent = "Error: Peer ID unavailable";
        }
        processTxnsButton.classList.remove("hidden");
        console.log("Process Transactions button shown after PAT save");
      } catch (error) {
        console.error("Failed to save PAT:", error);
        tokenMessage.textContent = "Error: Failed to save token";
      }
    });
    processTxnsButton.addEventListener("click", async () => {
      console.log("Process Transactions button clicked");
      try {
        document.getElementById("processing-message").classList.add("visible");
        await processTxns();
        document.getElementById("processing-message").classList.remove("visible");
        const updatedState = await fetchState();
        if (updatedState) {
          blockHeightDiv.textContent = `Block Height: ${updatedState.content.chain.length}`;
          console.log("Block height updated:", updatedState.content.chain.length);
        } else {
          console.error("Failed to fetch updated state");
          blockHeightDiv.textContent = "Error: Failed to fetch state";
        }
      } catch (error) {
        console.error("Failed to process transactions:", error);
        document.getElementById("processing-message").textContent = "Error: Failed to process transactions";
      }
    });
    document.getElementById("view-chain").addEventListener("click", async () => {
      console.log("View Chain button clicked");
      try {
        await viewChain();
      } catch (error) {
        console.error("Failed to view chain:", error);
        document.getElementById("output").textContent = "Error: Failed to view chain";
      }
    });
    if (!isServer) {
      const peers = getServerPeers();
      console.log("Active server peers:", peers);
    }
  } catch (error) {
    console.error("Error in DOMContentLoaded:", error);
    document.getElementById("token-message").textContent = "Error: Failed to initialize UI";
  }
});
//# sourceMappingURL=main.js.map
