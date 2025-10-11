/**
 * Admin Key Generator Script
 *
 * Usage:
 * 1. Install dependencies: npm install
 * 2. Run the script: npm run generate-admin-key
 *    - Generates a random private key using secp256k1.
 *    - Derives the Ethereum-style address (keccak256 of public key, last 20 bytes).
 *    - Saves the private key to 'admin.key' (git-ignored, keep secure!).
 *    - Outputs 'src/admin-address.ts' with export const ADMIN_ADDRESS = '0x...'; (git-ignored).
 *    - Logs the address and next steps.
 * 3. Rebuild: npm run build (includes admin-address.ts).
 * 4. Commit and push the updated js/blockchain.js to GitHub (do not commit admin.key or src/admin-address.ts).
 *
 * How to Mint New Coins:
 * - Only the admin can mint (transactions from ADMIN_ADDRESS ignore balance checks).
 * - Use the private key from 'admin.key' to sign a transaction:
 *   - from: ADMIN_ADDRESS
 *   - to: Desired recipient address
 *   - amount: Amount to mint
 *   - nonce: Current nonce for ADMIN_ADDRESS + 1 (check chain for last nonce)
 *   - signature: ECDSA signature (secp256k1, Keccak-256 hash of serialized {from, to, amount, nonce})
 * - Create a new issue in the repo with title starting with "tx" and body:
 *   {
 *     "type": "gitchain_txn",
 *     "repo": "owner/repo",
 *     "txn": { ...transaction object... }
 *   }
 * - The processor will handle it if valid, close the issue with confirmation.
 */

import { secp256k1 } from 'ethereum-cryptography/secp256k1';
import { keccak256 } from 'ethereum-cryptography/keccak';
import { bytesToHex } from 'ethereum-cryptography/utils';
import { writeFileSync } from 'fs';

const privKey = secp256k1.utils.randomPrivateKey();
const pubKey = secp256k1.getPublicKey(privKey);
const address = `0x${bytesToHex(keccak256(pubKey.slice(1)).slice(-20))}`;

writeFileSync('admin.key', bytesToHex(privKey));
writeFileSync('src/admin-address.ts', `export const ADMIN_ADDRESS = '${address}';`);

console.log(`Generated Admin Private Key saved to 'admin.key' (keep secure!)`);
console.log(`Admin Address: ${address}`);
console.log(`Generated src/admin-address.ts for build-time inclusion.`);
console.log(`Next: npm run build, then commit/push js/blockchain.js (do not commit admin.key or src/admin-address.ts).`);
