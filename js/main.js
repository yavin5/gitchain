document.addEventListener("gitchain:init", () => {
  const patInput = document.getElementById("patInput");
  const savePatButton = document.getElementById("savePat");
  const processTxnsButton = document.getElementById("processTxns");
  const viewChainButton = document.getElementById("viewChain");
  const tokenMessage = document.getElementById("tokenMessage");
  const blockHeight = document.getElementById("blockHeight");
  const peerIdDisplay = document.getElementById("peerId");
  const messageInput = document.getElementById("message");
  const sendButton = document.getElementById("send");
  const rpcUrlInput = document.getElementById("rpcUrl");
  const chainIdInput = document.getElementById("chainId");
  const generateWalletButton = document.getElementById("generateWallet");
  const walletInfoDiv = document.getElementById("walletInfo");
  const mnemonicDisplay = document.getElementById("mnemonic");
  const kasplexAddressDisplay = document.getElementById("kasplexAddress");
  const connectPeersButton = document.getElementById("connectPeers");
  const chatDiv = document.getElementById("chat");
  let signaling = null;
  let localPeerId = "";
  let connections = /* @__PURE__ */ new Map();
  if (window.gitchain && window.gitchain.initP2P) {
    window.gitchain.initP2P().then((peerId) => {
      localPeerId = peerId;
      peerIdDisplay.textContent = `Your Peer ID: ${peerId.slice(-8)}`;
    });
  }
  if (window.gitchain && window.gitchain.fetchState) {
    window.gitchain.fetchState().then((state) => {
      if (state && state.blocks) {
        blockHeight.textContent = `Block Height: ${state.blocks.length}`;
      }
    });
  }
  if (localStorage.getItem("github_pat")) {
    tokenMessage.textContent = "GitHub Personal Access Token saved.";
    processTxnsButton.classList.remove("hidden");
  } else {
    processTxnsButton.classList.add("hidden");
  }
  savePatButton.addEventListener("click", () => {
    const token = patInput.value.trim();
    if (token && window.gitchain && window.gitchain.saveGithubAccessToken) {
      window.gitchain.saveGithubAccessToken(token).then(() => {
        tokenMessage.textContent = "GitHub Personal Access Token saved.";
        processTxnsButton.classList.remove("hidden");
      }).catch((err) => {
        tokenMessage.textContent = "Error saving token: " + err.message;
      });
    }
  });
  processTxnsButton.addEventListener("click", () => {
    if (window.gitchain && window.gitchain.processTxns) {
      window.gitchain.processTxns();
    }
  });
  viewChainButton.addEventListener("click", () => {
    if (window.gitchain && window.gitchain.viewChain) {
      window.gitchain.viewChain();
    }
  });
  generateWalletButton.addEventListener("click", () => {
    if (window.gitchain && window.gitchain.KasplexSignalling) {
      signaling = new window.gitchain.KasplexSignalling(rpcUrlInput.value, chainIdInput.value);
      const wallet = signaling.generateWallet();
      mnemonicDisplay.textContent = wallet.mnemonic;
      kasplexAddressDisplay.textContent = wallet.address;
      walletInfoDiv.classList.remove("hidden");
      console.log("Kasplex wallet generated:", wallet);
    }
  });
  connectPeersButton.addEventListener("click", async () => {
    if (!signaling || !signaling.wallet) {
      alert("Generate wallet first and fund it with tKAS.");
      return;
    }
    await signaling.connect();
    const peers = window.gitchain.getServerPeers();
    for (const peerId of peers) {
      if (peerId !== localPeerId && !connections.has(peerId)) {
        const conn = new window.gitchain.WebRTCConnection(signaling, localPeerId, peerId);
        connections.set(peerId, conn);
        console.log(`Initiated WebRTC connection to ${peerId.slice(-8)}`);
      }
    }
  });
  sendButton.addEventListener("click", () => {
    const message = messageInput.value.trim();
    if (message) {
      connections.forEach((conn) => conn.send(message));
      const localMsg = document.createElement("div");
      localMsg.textContent = `${localPeerId.slice(-8)}: ${message}`;
      chatDiv.appendChild(localMsg);
      chatDiv.scrollTop = chatDiv.scrollHeight;
      messageInput.value = "";
    }
  });
});
//# sourceMappingURL=main.js.map
