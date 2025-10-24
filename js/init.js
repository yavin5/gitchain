import { saveGithubAccessToken, viewChain, processTxns, fetchState, updateState, initP2P, submitTransaction, getServerPeers, createOriginalBlock, KasplexSignalling, WebRTCConnection } from 'chain.ts';

window.gitchain = {
  saveGithubAccessToken, viewChain, processTxns, fetchState, updateState, initP2P,
  submitTransaction, getServerPeers, createOriginalBlock, KasplexSignalling, WebRTCConnection
};
document.dispatchEvent(new CustomEvent('gitchain:init'));
