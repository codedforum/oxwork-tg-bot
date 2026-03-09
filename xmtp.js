// XMTP Integration for OxWorkBot Alerts
// This module enables sending alerts via XMTP (DM on Base/Polygon)

const { Client } = require('xmtp');
const { Wallet } = require('ethers');
const fs = require('fs');
const path = require('path');

const XMTP_KEY_PATH = '/tmp/0xwork-users/xmtp-key.json';

// Load or generate XMTP key
async function getXmtpClient() {
  try {
    let privateKey;
    
    // Check for existing key
    if (fs.existsSync(XMTP_KEY_PATH)) {
      const data = JSON.parse(fs.readFileSync(XMTP_KEY_PATH, 'utf8'));
      privateKey = data.privateKey;
    } else {
      // Generate new wallet for XMTP
      const wallet = Wallet.createRandom();
      privateKey = wallet.privateKey;
      fs.writeFileSync(XMTP_KEY_PATH, JSON.stringify({ privateKey }));
      console.log('📬 New XMTP wallet created:', wallet.address);
    }
    
    const wallet = new Wallet(privateKey);
    const client = await Client.create(wallet, { env: 'production' });
    return client;
  } catch (e) {
    console.log('XMTP Error:', e.message);
    return null;
  }
}

// Send DM via XMTP
async function sendXmtpMessage(walletAddress, message) {
  try {
    const client = await getXmtpClient();
    if (!client) return false;
    
    // Get or start conversation
    const conversation = await client.conversations.newConversation(walletAddress);
    await conversation.send(message);
    
    console.log(`📬 XMTP message sent to ${walletAddress}`);
    return true;
  } catch (e) {
    console.log('XMTP send error:', e.message);
    return false;
  }
}

// Get bot's XMTP address
async function getXmtpAddress() {
  try {
    const client = await getXmtpClient();
    return client ? client.address : null;
  } catch (e) {
    return null;
  }
}

module.exports = { sendXmtpMessage, getXmtpAddress, getXmtpClient };

// If run directly, show info
if (require.main === module) {
  (async () => {
    const address = await getXmtpAddress();
    if (address) {
      console.log('📬 OxWorkBot XMTP Address:', address);
      console.log('Users can message you here to receive alerts via XMTP!');
    } else {
      console.log('❌ XMTP not available');
    }
  })();
}
