document.addEventListener("DOMContentLoaded", async () => {
  await new Promise((r) => setTimeout(r, 0));
  const patInput = document.getElementById("patInput");
  const savePatButton = document.getElementById("savePat");
  const processTxnsButton = document.getElementById("processTxns");
  const viewChainButton = document.getElementById("viewChain");
  const tokenMessage = document.getElementById("tokenMessage");
  const blockHeight = document.getElementById("blockHeight");
  const peerIdDisplay = document.getElementById("peerId");
  const messageInput = document.getElementById("message");
  const sendButton = document.getElementById("send");
  const chainIdInput = document.getElementById("chainId");
  const generateWalletBtn = document.getElementById("generateWallet");
  const walletInfoDiv = document.getElementById("walletInfo");
  const mnemonicDisplay = document.getElementById("mnemonic");
  const kasplexAddress = document.getElementById("kasplexAddress");
  const connectPeersBtn = document.getElementById("connectPeers");
  const chatDiv = document.getElementById("chat");
  let signaling = null;
  let localPeerId = "";
  const connections = /* @__PURE__ */ new Map();
  if (window.gitchain && window.gitchain.initP2P) {
    window.gitchain.initP2P().then((peerId) => {
      localPeerId = peerId;
      peerIdDisplay.textContent = `Your Peer ID: ${peerId.slice(-8)}`;
    });
  }
  if (window.gitchain && window.gitchain.fetchState) {
    window.gitchain.fetchState().then((state) => {
      if (state && state.content && state.content.chain) {
        blockHeight.textContent = `Block Height: ${state.content.chain.length}`;
      } else {
        blockHeight.textContent = `Block Height: 0`;
      }
    });
  }
  if (localStorage.getItem("gitchain_github_access_token")) {
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
    if (window.gitchain && window.gitchain.processTxns) window.gitchain.processTxns();
  });
  viewChainButton.addEventListener("click", () => {
    if (window.gitchain && window.gitchain.viewChain) window.gitchain.viewChain();
  });
  generateWalletBtn.addEventListener("click", () => {
    const chain = chainIdInput.value.trim() || "167012";
    signaling = new window.gitchain.KasplexSignalling(chain);
    const { mnemonic, address } = signaling.generateWallet();
    mnemonicDisplay.textContent = mnemonic;
    kasplexAddress.textContent = address;
    walletInfoDiv.classList.remove("hidden");
    console.log("Kasplex wallet generated:", { mnemonic, address });
  });
  connectPeersBtn.addEventListener("click", async () => {
    if (!signaling) return alert("Generate a wallet first.");
    await signaling.connect();
    const peers = window.gitchain.getServerPeers() || [];
    for (const peerId of peers) {
      if (peerId !== localPeerId && !connections.has(peerId)) {
        const conn = new window.gitchain.WebRTCConnection(signaling, localPeerId, peerId);
        connections.set(peerId, conn);
        console.log(`Initiated WebRTC connection to ${peerId.slice(-8)}`);
      }
    }
  });
  sendButton.addEventListener("click", () => {
    const msg = messageInput.value.trim();
    if (!msg) return;
    connections.forEach((conn) => conn.send(msg));
    const el = document.createElement("div");
    el.textContent = `${localPeerId.slice(-8)}: ${msg}`;
    chatDiv.appendChild(el);
    chatDiv.scrollTop = chatDiv.scrollHeight;
    messageInput.value = "";
  });
});
//# sourceMappingURL=main.js.map
