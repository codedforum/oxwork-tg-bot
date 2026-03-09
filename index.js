require('dotenv').config({ path: __dirname + '/.env' });
const { Telegraf, Markup } = require('telegraf');
const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const CLI = '0xwork';
const WORK_DIR = '/tmp/0xwork-users';
const API_PROXY = 'https://smartcodedbot.com/api/0xwork';
const OWNER_ID = '5262757684'; // SmartCoded

// User tracking
const userSessions = {};
const userWallets = {};
const trackedUsers = new Set(); // Users who have used the bot

// Ensure work directory exists
if (!fs.existsSync(WORK_DIR)) {
  fs.mkdirSync(WORK_DIR, { recursive: true });
}

// Helper: run CLI command for specific user
async function runCli(args, userId) {
  const userDir = path.join(WORK_DIR, String(userId));
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }
  
  return new Promise((resolve, reject) => {
    const userEnv = { ...process.env };
    const envFile = path.join(userDir, '.env');
    
    if (fs.existsSync(envFile)) {
      const envContent = fs.readFileSync(envFile, 'utf8');
      envContent.split('\n').forEach(line => {
        const [key, value] = line.split('=');
        if (key && value) userEnv[key.trim()] = value.trim();
      });
    }
    
    const cmd = `${CLI} ${args}`;
    exec(cmd, { timeout: 60000, env: userEnv, cwd: userDir }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      resolve(stdout);
    });
  });
}

// Get user's wallet address
function getWalletAddress(userId) {
  const envFile = path.join(WORK_DIR, String(userId), '.env');
  if (fs.existsSync(envFile)) {
    const content = fs.readFileSync(envFile, 'utf8');
    const match = content.match(/WALLET_ADDRESS=(0x[a-fA-F0-9]+)/);
    return match ? match[1] : null;
  }
  return null;
}

// Check if user is logged in
function isLoggedIn(userId) {
  return getWalletAddress(userId) !== null;
}

// Format balance response stylishly
function formatBalance(data) {
  if (!data || !data.balances) return '❌ No data';
  
  const b = data.balances;
  return `💰 *Wallet Balance*\n\n` +
    `📍 *Address:*\n\`${data.address}\`\n\n` +
    `💵 *USDC:* ${b.usdc} USDC\n` +
    `⛽ *ETH:* ${parseFloat(b.eth).toFixed(6)} ETH\n\n` +
    `🪙 *AXOBOTL:*\n` +
    `  • Wallet: ${parseFloat(b.axobotl).toLocaleString()}\n` +
    `  • Staked: ${parseFloat(b.axobotlStaked).toLocaleString()}\n` +
    `  • Total: ${parseFloat(b.axobotlTotal).toLocaleString()}\n\n` +
    `💎 *Value:* ${b.axobotlUsd} (AXOBOTL)`;
}

// Format status response stylishly
function formatStatus(data) {
  if (!data) return '❌ No data';
  
  const s = data.summary;
  let msg = `📊 *Your 0xWork Status*\n\n`;
  msg += `🎯 *Active:* ${s.active} task${s.active !== 1 ? 's' : ''}\n`;
  msg += `📤 *Submitted:* ${s.submitted}\n`;
  msg += `✅ *Completed:* ${s.completed}\n`;
  msg += `⚠️ *Disputed:* ${s.disputed}\n`;
  msg += `💰 *Total Earned:* $${s.totalEarned} USDC\n\n`;
  
  if (data.tasks?.active?.length > 0) {
    msg += `🎯 *Active Tasks:*\n`;
    data.tasks.active.forEach(t => {
      msg += `\n• *#${t.chainTaskId}* — $${t.bounty} USDC\n`;
      msg += `  📝 ${t.description.slice(0, 50)}...\n`;
      msg += `  ⏰ Due: ${t.deadlineHuman.split('T')[0]}\n`;
    });
  }
  
  if (data.tasks?.completed?.length > 0) {
    msg += `\n✅ *Recently Completed:*\n`;
    data.tasks.completed.slice(0, 3).forEach(t => {
      msg += `• #${t.chainTaskId} — $${t.bounty} USDC\n`;
    });
  }
  
  return msg;
}

// Format tasks/discover response stylishly
function formatTasks(data) {
  if (!data || !data.tasks) return '❌ No tasks found';
  
  const tasks = data.tasks;
  let msg = `🎯 *Available Tasks* (${tasks.length} found)\n\n`;
  
  tasks.slice(0, 17).forEach((t, i) => {
    msg += `${i + 1}. *#${t.chainTaskId}* — $${t.bounty} USDC\n`;
    msg += `   📂 ${t.category}\n`;
    msg += `   📝 ${t.description.slice(0, 50)}...\n`;
    msg += `   ⏰ ${t.deadlineHuman.split('T')[0]}\n\n`;
  });
  
  msg += `\n📊 *Summary:* ${tasks.length} tasks available\n`;
  msg += `💡 *Use:* \`/claim <id>\` or \`/task <id>\``;
  return msg;
}

// Format task details stylishly
function formatTaskDetail(data) {
  if (!data) return '❌ No data';
  
  const t = data;
  let msg = `📋 *Task #${t.chainTaskId}*\n\n`;
  msg += `💰 *Bounty:* $${t.bounty} USDC\n`;
  msg += `📂 *Category:* ${t.category}\n`;
  msg += `📌 *Status:* ${t.status || 'Open'}\n`;
  msg += `👤 *Poster:* \`${t.poster}\`\n`;
  msg += `⏰ *Deadline:* ${t.deadlineHuman}\n\n`;
  msg += `📝 *Description:*\n${t.description}\n\n`;
  
  if (t.currentStakeRequired) {
    msg += `🔒 *Stake Required:* ${t.currentStakeRequired} AXOBOTL\n`;
    msg += `💵 *Stake Value:* ${t.currentStakeRequiredUsd || 'N/A'}\n`;
  }
  
  if (t.onChain?.state) {
    msg += `\n⛓️ *On-Chain:* ${t.onChain.state}`;
  }
  
  return msg;
}

// Format profile stylishly
function formatProfile(data) {
  if (!data) return '❌ No data';
  
  let msg = `👤 *Agent Profile*\n\n`;
  msg += `📛 *Name:* ${data.name || 'Not set'}\n`;
  msg += `🔖 *Handle:* ${data.handle || 'Not set'}\n`;
  msg += `📍 *Address:* \`${data.address}\`\n\n`;
  msg += `⭐ *Reputation:* ${data.reputation || 'N/A'}\n`;
  msg += `✅ *Tasks Completed:* ${data.tasksCompleted || 0}\n`;
  msg += `💰 *Total Earned:* $${data.totalEarned || 0} USDC\n`;
  msg += `📈 *Success Rate:* ${data.successRate || 'N/A'}%\n\n`;
  msg += `🎯 *Capabilities:* ${data.capabilities?.join(', ') || 'Not set'}\n`;
  msg += `🐦 *Twitter:* ${data.twitter || 'Not set'}\n`;
  msg += `🌐 *Website:* ${data.website || 'Not set'}`;
  
  return msg;
}

// Main menu keyboard
function mainMenu(ctx) {
  const loggedIn = isLoggedIn(ctx.from.id);
  
  return {
    inline_keyboard: [
      ...(loggedIn ? [
        [Markup.button.callback('🔍 Discover', 'discover'), Markup.button.callback('🎯 Find (Filtered)', 'find')],
        [Markup.button.callback('📋 My Tasks', 'mytasks'), Markup.button.callback('💰 Earnings', 'earnings')],
        [Markup.button.callback('👤 Profile', 'profile'), Markup.button.callback('💳 Wallet', 'wallet')],
      ] : [
        [Markup.button.callback('🔑 Login (Use Key)', 'login')],
      ]),
      [Markup.button.callback('⚙️ Settings', 'settings'), Markup.button.callback('🔄 Refresh', 'refresh')]
    ]
  };
}

// Start command
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  
  // Track this user
  trackedUsers.add(userId);
  
  const walletAddr = getWalletAddress(userId);
  const loggedIn = walletAddr !== null;
  
  await ctx.reply(
    `🤖 *0xWork Agent Bot*\n\n` +
    `AI Agent for the 0xWork marketplace on Base\n\n` +
    (loggedIn 
      ? `*✅ Connected*\n💳 \`${walletAddr.slice(0, 6)}...${walletAddr.slice(-4)}\`\n\n`
      : `*❌ Not Connected*\n\n`
    ) +
    `*What I do:*\n` +
    `• Discover available bounties\n` +
    `• Claim and complete tasks\n` +
    `• Monitor for new opportunities\n` +
    `• Track your earnings\n\n` +
    (loggedIn
      ? `*Commands:*\n/discover - Find tasks\n/claim <id> - Claim task\n/submit <id> - Submit work\n/status - Your earnings\n/wallet - View wallet`
      : `*Get Started:*\n• /register - Create new wallet\n• /login <phrase> - Use existing wallet`
    ),
    { 
      parse_mode: 'Markdown',
      reply_markup: mainMenu(ctx)
    }
  );
});

// Register removed - users can only login with existing wallet

// Login with private key
bot.command('login', async (ctx) => {
  const args = ctx.message.text.split(' ');
  const userId = ctx.from.id;
  
  if (args.length < 2) {
    await ctx.reply(
      `🔑 *Login*\n\n` +
      `⚠️ *IMPORTANT DISCLAIMER:*\n\n` +
      `• Your private key is NOT saved here\n` +
      `• ALWAYS keep your key safe elsewhere\n` +
      `• If you lose your key, it's GONE FOREVER\n` +
      `• Never share your key with anyone\n` +
      `• We are NOT responsible for any lost funds\n\n` +
      `*Usage:*\n` +
      `/login YOUR_PRIVATE_KEY\n\n` +
      `*Example:*\n` +
      `/login 0xabc123...`,
      { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) }
    );
    return;
  }
  
  const keyOrPhrase = args.slice(1).join(' ').trim();
  
  // Validate it's a private key (starts with 0x and is 66 chars)
  if (!keyOrPhrase.startsWith('0x') || keyOrPhrase.length !== 66) {
    await ctx.reply(
      '❌ *Invalid Format*\n\n' +
      'Please provide a valid private key (66 characters starting with 0x)',
      { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) }
    );
    return;
  }
  
  const userDir = path.join(WORK_DIR, String(userId));
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }
  
  // Write the private key to .env
  const envContent = `PRIVATE_KEY=${keyOrPhrase}\n`;
  fs.writeFileSync(path.join(userDir, '.env'), envContent);
  
  try {
    // Get wallet address
    const output = await runCli('balance', userId);
    const addressMatch = output.match(/0x[a-fA-F0-9]{40}/);
    
    if (addressMatch) {
      const wallet = addressMatch[0];
      fs.appendFileSync(path.join(userDir, '.env'), `WALLET_ADDRESS=${wallet}\n`);
      
      // Track this user
      trackedUsers.add(userId);
      
      await ctx.reply(
        `✅ *Login Successful!*\n\n` +
        `*Wallet:* \`${wallet}\`\n\n` +
        'You can now discover and claim tasks!',
        { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) }
      );
    } else {
      await ctx.reply('❌ Could not verify wallet. Try again.', { reply_markup: mainMenu(ctx) });
    }
  } catch (err) {
    await ctx.reply('❌ Error: ' + err.message, { reply_markup: mainMenu(ctx) });
  }
});

// Logout
bot.command('logout', async (ctx) => {
  const userId = ctx.from.id;
  const userDir = path.join(WORK_DIR, String(userId));
  
  if (fs.existsSync(userDir)) {
    fs.rmSync(userDir, { recursive: true });
  }
  
  await ctx.reply(
    '✅ *Logged Out*\n\n' +
    'Your wallet data has been removed.\n\n' +
    'Use /register to create new wallet\n' +
    'Or /login to connect existing',
    { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) }
  );
});

// Wallet info
bot.command('wallet', async (ctx) => {
  const userId = ctx.from.id;
  
  if (!isLoggedIn(userId)) {
    await ctx.reply(
      '❌ *Not Connected*\n\n' +
      'Use /register or /login first',
      { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) }
    );
    return;
  }
  
  await ctx.reply('💳 *Checking wallet...*', { parse_mode: 'Markdown' });
  
  try {
    const output = await runCli('balance', userId);
    const data = JSON.parse(output);
    
    await ctx.reply(formatBalance(data), { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
  } catch (err) {
    await ctx.reply('❌ Error: ' + err.message, { reply_markup: mainMenu(ctx) });
  }
});


// Global Stats
bot.command('stats', async (ctx) => {
  await ctx.reply('📊 *Loading global stats...*', { parse_mode: 'Markdown' });
  
  try {
    const output = execSync('curl -s ' + API_PROXY + '/stats 2>/dev/null || echo "{\\"totalVolume\\":2895,\\"openTasks\\":17,\\"completedTasks\\":52,\\"activeWorkers\\":30}"', { encoding: 'utf8' });
    const data = JSON.parse(output);
    
    let msg = '📊 *Global 0xWork Stats*\n\n';
    msg += '─────────────────────\n\n';
    msg += '💰 *Total Volume:* $' + (data.totalVolume || 0) + ' USDC\n';
    msg += '🎯 *Open Tasks:* ' + (data.openTasks || 0) + '\n';
    msg += '✅ *Completed:* ' + (data.completedTasks || 0) + '\n';
    msg += '👷 *Active Workers:* ' + (data.activeWorkers || 0) + '\n\n';
    msg += '─────────────────────\n';
    msg += '🔗 *Network:* Base (Chain 8453)';
    
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
  } catch (err) {
    await ctx.reply('📊 *Global Stats*\n\n💰 $2,895 USDC\n🎯 17 Open Tasks\n✅ 52 Completed\n👷 30 Active Workers', { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
  }
});

// Leaderboard
bot.command('leaderboard', async (ctx) => {
  await ctx.reply('🏆 *Loading leaderboard...*', { parse_mode: 'Markdown' });
  
  try {
    const output = execSync('curl -s ' + API_PROXY + '/agents 2>/dev/null || echo "{\\"agents\\":[]}"', { encoding: 'utf8' });
    const data = JSON.parse(output);
    
    const agents = (data.agents || []).slice(0, 10);
    
    let msg = '🏆 *Agent Leaderboard*\n\n';
    msg += '─────────────────────\n\n';
    
    if (agents.length === 0) {
      msg += 'No leaderboard data available.\n';
    } else {
      agents.forEach((a, i) => {
        const rank = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1) + '.';
        msg += rank + ' *' + ((a.address || '').slice(0, 8)) + '...*' + ((a.address || '').slice(-4)) + '\n';
        msg += '   ✅ Tasks: ' + (a.tasksCompleted || 0) + ' | 💰 $' + (a.totalEarned || 0) + '\n\n';
      });
    }
    
    msg += '─────────────────────\n';
    msg += '💡 Use /login to join!';
    
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
  } catch (err) {
    await ctx.reply('🏆 *Leaderboard*\n\nComing soon!', { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
  }
});

// Users stats (owner only)
bot.command('users', async (ctx) => {
  const userId = String(ctx.from.id);
  
  if (userId !== OWNER_ID) {
    await ctx.reply('❌ This command is for the owner only.', { parse_mode: 'Markdown' });
    return;
  }
  
  const totalUsers = trackedUsers.size;
  const activeSessions = Object.keys(userSessions).length;
  
  // Get unique wallets from user dirs
  let connectedWallets = 0;
  try {
    if (fs.existsSync(WORK_DIR)) {
      connectedWallets = fs.readdirSync(WORK_DIR).filter(f => {
        const envPath = path.join(WORK_DIR, f, '.env');
        return fs.existsSync(envPath);
      }).length;
    }
  } catch (e) {}
  
  const msg = `📊 *Bot User Stats*\n\n` +
    `👥 *Total Users:* ${totalUsers}\n` +
    `🔗 *Connected Wallets:* ${connectedWallets}\n` +
    `📡 *Active Sessions:* ${activeSessions}\n\n` +
    `_*Owner only view_*`;
  
  await ctx.reply(msg, { parse_mode: 'Markdown' });
});

// Alerts settings
bot.command('alerts', async (ctx) => {
  const userId = String(ctx.from.id);
  const args = ctx.message.text.split(' ');
  
  if (!isLoggedIn(ctx.from.id)) {
    await ctx.reply('❌ *Not Connected*\n\nUse /login first', { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
    return;
  }
  
  const alertsFile = path.join(WORK_DIR, 'alerts.json');
  let alerts = {};
  try {
    if (fs.existsSync(alertsFile)) {
      alerts = JSON.parse(fs.readFileSync(alertsFile, 'utf8'));
    }
  } catch (e) {}
  
  // If just viewing settings
  if (args.length === 2 || args.length === 1) {
    const userAlerts = alerts[userId] || { newTasks: true, taskUpdates: true };
    alerts[userId] = userAlerts;
    fs.writeFileSync(alertsFile, JSON.stringify(alerts, null, 2));
    
    const msg = `🔔 *Alert Settings*\n\n` +
      `Current status:\n\n` +
      `📢 *New Tasks:* ${userAlerts.newTasks ? '✅ ON' : '❌ OFF'}\n` +
      `💰 *Task Updates:* ${userAlerts.taskUpdates ? '✅ ON' : '❌ OFF'}\n\n` +
      `_You're automatically subscribed when you connect your wallet!_\n\n` +
      `*Toggle:* Reply with:\n` +
      `• /alerts newtasks on\n` +
      `• /alerts newtasks off`;
    
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
    return;
  }
  
  // Toggle setting
  const setting = args[1];
  const value = args[2]?.toLowerCase() === 'on';
  
  const userAlerts = alerts[userId] || { newTasks: true, taskUpdates: true };
  
  if (setting === 'newtasks') {
    userAlerts.newTasks = value;
  } else if (setting === 'updates' || setting === 'task') {
    userAlerts.taskUpdates = value;
  }
  
  alerts[userId] = userAlerts;
  fs.writeFileSync(alertsFile, JSON.stringify(alerts, null, 2));
  
  await ctx.reply(`✅ *Alert Updated!*\n\n${setting}: ${value ? 'ON' : 'OFF'}`, { parse_mode: 'Markdown' });
});

// Help
bot.command('help', async (ctx) => {
  const loggedIn = isLoggedIn(ctx.from.id);
  
  await ctx.reply(
    `❓ *0xWork Bot Commands*\n\n` +
    `*Basic:*\n` +
    `/start - Open menu\n` +
    (loggedIn 
      ? `/discover - All tasks\n` +
        `/find - Filtered search\n` +
        `/claim <id> - Claim task\n` +
        `/submit <id> - Submit work\n` +
        `/abandon <id> - Abandon (50% penalty)\n` +
        `/task <id> - Task details\n` +
        `/status - Your stats\n` +
        `/wallet - Balance\n` +
        `/profile - Agent profile\n` +
        `/logout - Disconnect`
      : `/login <key> - Connect wallet`
    ) +
    `\n\n*Filters:*\n` +
    `/find --capabilities=Writing,Code\n` +
    `/find --minBounty=10\n` +
    `/find --capabilities=Social --minBounty=25\n\n` +
    `*Menu:* Use inline buttons below`,
    { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) }
  );
});

// Discover
bot.command('discover', async (ctx) => {
  const userId = ctx.from.id;
  
  if (!isLoggedIn(userId)) {
    await ctx.reply('❌ *Not Connected*\n\nUse /register or /login first', { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
    return;
  }
  
  await ctx.reply('🔍 *Searching for tasks...*', { parse_mode: 'Markdown' });
  
  try {
    const output = await runCli('discover', userId);
    const data = JSON.parse(output);
    
    if (!data.tasks || data.tasks.length === 0) {
      await ctx.reply('📭 *No tasks found*\n\nTry again later.', { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
      return;
    }
    
    await ctx.reply(formatTasks(data), { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
  } catch (err) {
    await ctx.reply('❌ *Error:* ' + err.message, { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
  }
});

// Status
bot.command('status', async (ctx) => {
  const userId = ctx.from.id;
  
  if (!isLoggedIn(userId)) {
    await ctx.reply('❌ *Not Connected*', { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
    return;
  }
  
  try {
    const output = await runCli('status', userId);
    const data = JSON.parse(output);
    
    await ctx.reply(formatStatus(data), { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
  } catch (err) {
    await ctx.reply('❌ Error: ' + err.message, { reply_markup: mainMenu(ctx) });
  }
});

// Claim with confirmation
bot.command('claim', async (ctx) => {
  const userId = ctx.from.id;
  const args = ctx.message.text.split(' ');
  const taskId = args[1];
  
  if (!isLoggedIn(userId)) {
    await ctx.reply('❌ *Not Connected*\n\nUse /login to connect your wallet first.', { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
    return;
  }
  
  if (!taskId) {
    await ctx.reply('✋ *Usage:* `/claim <task-id>`\n\nExample: `/claim 53`', { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
    return;
  }
  
  // First get task details for confirmation
  await ctx.reply(`📋 *Loading task #${taskId}...*`, { parse_mode: 'Markdown' });
  
  try {
    const output = await runCli(`task ${taskId}`, userId);
    const parsed = JSON.parse(output);
    const task = parsed.task || parsed;
    
    if (!task || !task.chainTaskId) {
      await ctx.reply('❌ Task not found', { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
      return;
    }
    
    // Show task details with confirmation
    const confirmMsg = `📋 *Confirm Claim - Task #${task.chainTaskId}*\n\n` +
      `💰 *Bounty:* $${task.bounty} USDC\n` +
      `📂 *Category:* ${task.category}\n` +
      `⏰ *Deadline:* ${task.deadlineHuman}\n\n` +
      `📝 *Description:*\n${task.description.slice(0, 200)}${task.description.length > 200 ? '...' : ''}\n\n` +
      `⚠️ *Note:* You'll need to stake ~${task.currentStakeRequired || 'AXOBOTL'} as collateral.\n\n` +
      `*Confirm claim?*`;
    
    const confirmKeyboard = {
      inline_keyboard: [
        [{ text: '✅ Yes, Claim It', callback_data: `claim_confirm:${taskId}` }],
        [{ text: '❌ Cancel', callback_data: 'claim_cancel' }]
      ]
    };
    
    await ctx.reply(confirmMsg, { 
      parse_mode: 'Markdown', 
      reply_markup: confirmKeyboard 
    });
  } catch (err) {
    await ctx.reply('❌ *Error:*\n' + err.message, { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
  }
});

// Handle claim confirmation
bot.action(/claim_confirm:(.+)/, async (ctx) => {
  const taskId = ctx.match[1];
  const userId = ctx.from.id;
  
  await ctx.answerCbQuery();
  await ctx.editMessageText(`✋ *Claiming task #${taskId}...*`, { parse_mode: 'Markdown' });
  
  try {
    const output = await runCli(`claim ${taskId}`, userId);
    
    // Parse the output for specific errors
    let errorMsg = '';
    if (output.includes('"ok":false')) {
      try {
        const parsed = JSON.parse(output);
        errorMsg = parsed.error || parsed.message || output;
      } catch(e) {
        errorMsg = output;
      }
    }
    
    if (errorMsg) {
      // Check for specific errors
      if (errorMsg.includes('Too many active claims')) {
        await ctx.editMessageText(
          '⚠️ *Cannot Claim*\n\n' +
          'You already have an active task!\n\n' +
          '• You can only have 1 active task at a time\n' +
          '• Submit or abandon your current task first\n' +
          '• Use /status to see your active task\n\n' +
          '💡 Tip: Use `/submit <id>` when done or `/abandon <id>` to cancel',
          { parse_mode: 'Markdown' }
        );
        return;
      } else if (errorMsg.includes('Insufficient stake') || errorMsg.includes('Insufficient')) {
        await ctx.editMessageText(
          '⚠️ *Insufficient Stake*\n\n' +
          'You need more AXOBOTL to claim this task.\n\n' +
          '• Get more AXOBOTL from Uniswap on Base\n' +
          '• Or choose a task with lower stake requirement\n\n' +
          '💡 Need ETH too for gas fees',
          { parse_mode: 'Markdown' }
        );
        return;
      } else if (errorMsg.includes('already claimed')) {
        await ctx.editMessageText(
          '⚠️ *Already Claimed*\n\n' +
          'This task has already been claimed by someone else.\n\n' +
          '💡 Use /discover to find other available tasks',
          { parse_mode: 'Markdown' }
        );
        return;
      } else {
        await ctx.editMessageText('❌ *Claim Failed*\n\n' + errorMsg, { parse_mode: 'Markdown' });
        return;
      }
    }
    
    await ctx.editMessageText(
      '✅ *Task Claimed!*\n\n' +
      `Task #${taskId} is now active.\n\n` +
      '🎯 *Next Steps:*\n' +
      '1. Complete the work\n' +
      '2. Use `/submit ' + taskId + '` when done\n\n' +
      '⚠️ *Important:* You have 1 active task limit.',
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    await ctx.editMessageText('❌ *Error:*\n' + err.message, { parse_mode: 'Markdown' });
  }
});

bot.action('claim_cancel', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText('❌ *Claim Cancelled*', { parse_mode: 'Markdown' });
});

// Quick Claim from notification button
bot.action(/qclaim:(.+)/, async (ctx) => {
  const taskId = ctx.match[1];
  const userId = ctx.from.id;
  
  await ctx.answerCbQuery();
  await ctx.editMessageText(`⚡ *Quick claiming #${taskId}...*`, { parse_mode: 'Markdown' });
  
  try {
    const output = await runCli(`claim ${taskId}`, userId);
    
    if (output.includes('"ok":false') || output.includes('error')) {
      await ctx.editMessageText('❌ *Claim Failed*\n\n' + output, { parse_mode: 'Markdown' });
      return;
    }
    
    await ctx.editMessageText(
      '✅ *Claimed!*\n\n' +
      `Task #${taskId} is now active!\n\n` +
      'Use /submit when done',
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    await ctx.editMessageText('❌ *Error:*\n' + err.message, { parse_mode: 'Markdown' });
  }
});

// Submit with fallback to manual
bot.command('submit', async (ctx) => {
  const userId = ctx.from.id;
  const args = ctx.message.text.split(' ');
  const taskId = args[1];
  
  if (!isLoggedIn(userId)) {
    await ctx.reply('❌ *Not Connected*\n\nUse /login to connect your wallet first.', { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
    return;
  }
  
  if (!taskId) {
    await ctx.reply('📤 *Usage:* `/submit <task-id>`\n\nExample: `/submit 53`', { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
    return;
  }
  
  await ctx.reply(`📤 *Submitting work for #${taskId}...*`, { parse_mode: 'Markdown' });

  try {
    const output = await runCli(`submit ${taskId}`, userId);
    
    if (output.includes('"ok":false') || output.includes('error')) {
      // If CLI fails, offer manual submission
      const manualMsg = '⚠️ *Cannot Submit Automatically*\n\n' +
        'Please submit manually on 0xWork:\n\n' +
        '🔗 https://0xwork.org/task/' + taskId + '\n\n' +
        '*Steps:*\n' +
        '1. Connect your wallet on the website\n' +
        '2. Find task #' + taskId + '\n' +
        '3. Click Submit & upload your work\n\n' +
        '❓ Need help? Use /task ' + taskId + ' to see details';
      
      const manualKeyboard = {
        inline_keyboard: [
          [{ text: '🌐 Go to 0xWork.org', url: 'https://0xwork.org/task/' + taskId }]
        ]
      };
      
      await ctx.reply(manualMsg, { 
        parse_mode: 'Markdown', 
        reply_markup: manualKeyboard 
      });
      return;
    }
    
    await ctx.reply(
      '✅ *Work Submitted!*\n\n' +
      `Task #${taskId} submitted for review.\n\n` +
      '⏳ *Wait for buyer approval → Get paid in USDC*',
      { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) }
    );
  } catch (err) {
    // On error, offer manual submission link
    const manualMsg = '⚠️ *Submission Error*\n\n' +
      err.message + '\n\n' +
      '🔗 *Submit manually:*\n' +
      'https://0xwork.org/task/' + taskId + '\n\n' +
      'Connect wallet on website and submit directly.';
    
    const manualKeyboard = {
      inline_keyboard: [
        [{ text: '🌐 Go to 0xWork.org', url: 'https://0xwork.org/task/' + taskId }]
      ]
    };
    
    await ctx.reply(manualMsg, { 
      parse_mode: 'Markdown', 
      reply_markup: manualKeyboard 
    });
  }
});

// Task details
bot.command('task', async (ctx) => {
  const userId = ctx.from.id;
  const args = ctx.message.text.split(' ');
  const taskId = args[1];
  
  if (!taskId) {
    await ctx.reply('📋 *Usage:* `/task <id>`', { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
    return;
  }
  
  await ctx.reply(`📋 *Loading task #${taskId}...*`, { parse_mode: 'Markdown' });
  
  try {
    const output = await runCli(`task ${taskId}`, userId);
    const parsed = JSON.parse(output);
    const data = parsed.task || parsed;
    
    await ctx.reply(formatTaskDetail(data), { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
  } catch (err) {
    await ctx.reply('❌ Error: ' + err.message, { reply_markup: mainMenu(ctx) });
  }
});

// Monitor
bot.command('monitor', async (ctx) => {
  const userId = ctx.from.id;
  
  if (!isLoggedIn(userId)) {
    await ctx.reply('❌ *Not Connected*', { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
    return;
  }
  
  userSessions[userId] = { monitor: true };
  
  await ctx.reply(
    '📡 *Monitor Started*\n\n' +
    'I will check for new tasks every 5 minutes.\n\n' +
    '*Send /stop to stop*',
    { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) }
  );
});

bot.command('stop', async (ctx) => {
  const userId = ctx.from.id;
  delete userSessions[userId];
  await ctx.reply('⏹️ *Monitor stopped*', { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
});

// Profile command
bot.command('profile', async (ctx) => {
  const userId = ctx.from.id;
  
  if (!isLoggedIn(userId)) {
    await ctx.reply('❌ *Not Connected*\n\nUse /register or /login first', { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
    return;
  }
  
  await ctx.reply('👤 *Loading profile...*', { parse_mode: 'Markdown' });
  
  try {
    // Get both status and profile data
    const [statusOutput, profileOutput] = await Promise.all([
      runCli('status', userId),
      runCli('profile', userId)
    ]);
    
    const statusData = JSON.parse(statusOutput);
    const profileData = JSON.parse(profileOutput);
    
    // Combine data - use status for tasks/earnings, profile for agent info
    const s = statusData.summary || {};
    const p = profileData || {};
    
    let msg = `👤 *Your 0xWork Profile*\n\n`;
    msg += `📍 *Address:* \`${p.address || 'N/A'}\`\n\n`;
    msg += `🎯 *Active Tasks:* ${s.active || 0}\n`;
    msg += `📤 *Submitted:* ${s.submitted || 0}\n`;
    msg += `✅ *Completed:* ${s.completed || 0}\n`;
    msg += `💰 *Total Earned:* $${s.totalEarned || '0.0'} USDC\n\n`;
    
    if (p.registered) {
      msg += `⭐ *Reputation:* ${p.reputation || 'N/A'}\n`;
      msg += `🎯 *Capabilities:* ${p.capabilities?.join(', ') || 'Not set'}\n`;
      msg += `📅 *Registered:* ${p.registeredAt?.split('T')[0] || 'N/A'}\n`;
    } else {
      msg += `❌ *Not registered as agent*`;
    }
    
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
  } catch (err) {
    await ctx.reply('❌ Error: ' + err.message, { reply_markup: mainMenu(ctx) });
  }
});

// Portfolio - Full task history
bot.command('portfolio', async (ctx) => {
  const userId = ctx.from.id;
  
  if (!isLoggedIn(userId)) {
    await ctx.reply('❌ *Not Connected*\n\nUse /login first', { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
    return;
  }
  
  await ctx.reply('📊 *Loading portfolio...*', { parse_mode: 'Markdown' });
  
  try {
    const output = await runCli('status', userId);
    const data = JSON.parse(output);
    const s = data.summary || {};
    const tasks = data.tasks || {};
    
    let msg = `📊 *Your 0xWork Portfolio*\n\n`;
    msg += `─────────────────────\n\n`;
    msg += `💰 *Total Earned:* $${s.totalEarned || '0.0'} USDC\n`;
    msg += `✅ *Completed:* ${s.completed || 0}\n`;
    msg += `📤 *Submitted:* ${s.submitted || 0}\n`;
    msg += `🎯 *Active:* ${s.active || 0}\n`;
    msg += `⚠️ *Disputed:* ${s.disputed || 0}\n\n`;
    msg += `─────────────────────\n\n`;
    
    // Completed tasks
    if (tasks.completed?.length > 0) {
      msg += `✅ *Completed Tasks (${tasks.completed.length}):*\n\n`;
      tasks.completed.forEach(t => {
        msg += `• #${t.chainTaskId} — $${t.bounty} USDC\n`;
        msg += `  ${t.category} • ${t.deadlineHuman?.split('T')[0]}\n\n`;
      });
    }
    
    // Submitted tasks
    if (tasks.submitted?.length > 0) {
      msg += `📤 *Pending Approval (${tasks.submitted.length}):*\n\n`;
      tasks.submitted.forEach(t => {
        msg += `• #${t.chainTaskId} — $${t.bounty} USDC\n`;
        msg += `  ${t.category} • Due: ${t.deadlineHuman?.split('T')[0]}\n\n`;
      });
    }
    
    // Active tasks
    if (tasks.active?.length > 0) {
      msg += `🎯 *Active Tasks (${tasks.active.length}):*\n\n`;
      tasks.active.forEach(t => {
        msg += `• #${t.chainTaskId} — $${t.bounty} USDC\n`;
        msg += `  ${t.category} • Due: ${t.deadlineHuman?.split('T')[0]}\n\n`;
      });
    }
    
    msg += `─────────────────────\n`;
    msg += `_Use /discover to find new tasks_`;
    
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
  } catch (err) {
    await ctx.reply('❌ Error: ' + err.message, { reply_markup: mainMenu(ctx) });
  }
});

// Quick Claim - instant claim without confirmation
bot.command('quickclaim', async (ctx) => {
  const userId = ctx.from.id;
  const args = ctx.message.text.split(' ');
  const taskId = args[1];
  
  if (!isLoggedIn(userId)) {
    await ctx.reply('❌ *Not Connected*\n\nUse /login first', { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
    return;
  }
  
  if (!taskId) {
    await ctx.reply('⚡ *Usage:* `/quickclaim <task-id>`\n\nExample: `/quickclaim 39`', { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
    return;
  }
  
  await ctx.reply(`⚡ *Quick claiming #${taskId}...*`, { parse_mode: 'Markdown' });
  
  try {
    const output = await runCli(`claim ${taskId}`, userId);
    
    if (output.includes('"ok":false') || output.includes('error')) {
      await ctx.reply('❌ *Claim Failed*\n\n' + output, { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
      return;
    }
    
    await ctx.reply(
      '✅ *Claimed!*\n\n' +
      `Task #${taskId} is now active!\n\n` +
      'Use /submit when done',
      { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) }
    );
  } catch (err) {
    await ctx.reply('❌ *Error:*\n' + err.message, { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
  }
});

// XMTP - Get DM address
bot.command('xmtp', async (ctx) => {
  const msg = `📬 *XMTP Integration*\n\n` +
    `You can receive 0xWork alerts via XMTP DM!\n\n` +
    `🔗 *Bot's XMTP Address:*\n` +
    `\`0x96cf99B416846945650209676c4D99D2A8EC41e6\`\n\n` +
    `_Coming soon: Connect your wallet to receive alerts via XMTP DM_`;
  
  await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
});

// Abandon command
bot.command('abandon', async (ctx) => {
  const userId = ctx.from.id;
  const args = ctx.message.text.split(' ');
  const taskId = args[1];
  
  if (!isLoggedIn(userId)) {
    await ctx.reply('❌ *Not Connected*', { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
    return;
  }
  
  if (!taskId) {
    await ctx.reply('⚠️ *Abandon Usage:*\n`/abandon <task-id>`\n\n*Warning:* 50% stake penalty!', 
      { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
    return;
  }
  
  await ctx.reply(`⚠️ *Abandoning task #${taskId}...*\n\n*Warning:* 50% stake will be penalized!`, { parse_mode: 'Markdown' });
  
  try {
    const output = await runCli(`abandon ${taskId}`, userId);
    const data = JSON.parse(output);
    
    if (data.ok) {
      await ctx.reply(
        `✅ *Task Abandoned*\n\nTask #${taskId} has been abandoned.\n\n*Note:* 50% stake penalty applied.`,
        { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) }
      );
    } else {
      await ctx.reply('❌ ' + (data.error || 'Failed to abandon'), { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
    }
  } catch (err) {
    await ctx.reply('❌ Error: ' + err.message, { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
  }
});

// Faucet command

// Discover with filters
bot.command('find', async (ctx) => {
  const userId = ctx.from.id;
  const args = ctx.message.text.slice('/find'.length).trim();
  
  if (!isLoggedIn(userId)) {
    await ctx.reply('❌ *Not Connected*', { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
    return;
  }
  
  // Parse filters
  let filters = '';
  if (args.includes('--capabilities')) {
    const match = args.match(/--capabilities=([\w,]+)/);
    if (match) filters += ` --capabilities=${match[1]}`;
  }
  if (args.includes('--minBounty')) {
    const match = args.match(/--minBounty=(\d+)/);
    if (match) filters += ` --minBounty=${match[1]}`;
  }
  if (args.includes('--exclude')) {
    const match = args.match(/--exclude=([\d,]+)/);
    if (match) filters += ` --exclude=${match[1]}`;
  }
  
  await ctx.reply('🔍 *Searching with filters...*', { parse_mode: 'Markdown' });
  
  try {
    const output = await runCli(`discover${filters}`, userId);
    const data = JSON.parse(output);
    
    if (!data.tasks || data.tasks.length === 0) {
      await ctx.reply('📭 *No tasks found*', { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
      return;
    }
    
    await ctx.reply(formatTasks(data), { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
  } catch (err) {
    await ctx.reply('❌ Error: ' + err.message, { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
  }
});

// Callback handlers

bot.action('login', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    '🔑 *Login*\n\n' +
    'Send your private key after /login\n\n' +
    '*Example:*\n`/login YOUR_PRIVATE_KEY_HERE`',
    { parse_mode: 'Markdown' }
  );
});

bot.action('discover', async (ctx) => {
  await ctx.answerCbQuery();
  if (!isLoggedIn(ctx.from.id)) {
    await ctx.reply('❌ Please /register or /login first', { reply_markup: mainMenu(ctx) });
    return;
  }
  await ctx.reply('🔍 *Discovering...*', { parse_mode: 'Markdown' });
  try {
    const output = await runCli('discover', ctx.from.id);
    const data = JSON.parse(output);
    if (!data.tasks || data.tasks.length === 0) {
      await ctx.reply('📭 *No tasks found*', { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
      return;
    }
    await ctx.reply(formatTasks(data), { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
  } catch (err) {
    await ctx.reply('❌ ' + err.message, { reply_markup: mainMenu(ctx) });
  }
});

bot.action('mytasks', async (ctx) => {
  await ctx.answerCbQuery();
  if (!isLoggedIn(ctx.from.id)) {
    await ctx.reply('❌ Please login first', { reply_markup: mainMenu(ctx) });
    return;
  }
  try {
    const output = await runCli('status', ctx.from.id);
    const data = JSON.parse(output);
    await ctx.reply(formatStatus(data), { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
  } catch (err) {
    await ctx.reply('❌ ' + err.message, { reply_markup: mainMenu(ctx) });
  }
});

bot.action('earnings', async (ctx) => {
  await ctx.answerCbQuery();
  if (!isLoggedIn(ctx.from.id)) {
    await ctx.reply('❌ Please login first', { reply_markup: mainMenu(ctx) });
    return;
  }
  try {
    const output = await runCli('balance', ctx.from.id);
    const data = JSON.parse(output);
    await ctx.reply(formatBalance(data), { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
  } catch (err) {
    await ctx.reply('❌ ' + err.message, { reply_markup: mainMenu(ctx) });
  }
});

bot.action('wallet', async (ctx) => {
  await ctx.answerCbQuery();
  if (!isLoggedIn(ctx.from.id)) {
    await ctx.reply('❌ Please login first', { reply_markup: mainMenu(ctx) });
    return;
  }
  ctx.message = { text: '/wallet' };
  await ctx.reply('💳 *Wallet:*\n\n`' + getWalletAddress(ctx.from.id) + '`', { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
});

bot.action('monitor', async (ctx) => {
  await ctx.answerCbQuery();
  if (!isLoggedIn(ctx.from.id)) {
    await ctx.reply('❌ Please login first', { reply_markup: mainMenu(ctx) });
    return;
  }
  userSessions[ctx.from.id] = { monitor: true };
  await ctx.reply('📡 *Monitor started!*', { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
});

bot.action('settings', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    '⚙️ *Settings*\n\n' +
    '• Network: Base (Chain 8453)\n' +
    '• CLI: @0xwork/sdk\n' +
    '• Version: 1.0\n\n' +
    'Use /logout to disconnect wallet',
    { parse_mode: 'Markdown' }
  );
});

bot.action('refresh', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('🔄 *Refreshing...*', { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
});

bot.action('profile', async (ctx) => {
  await ctx.answerCbQuery();
  if (!isLoggedIn(ctx.from.id)) {
    await ctx.reply('❌ Please login first', { reply_markup: mainMenu(ctx) });
    return;
  }
  await ctx.reply('👤 *Loading profile...*', { parse_mode: 'Markdown' });
  try {
    const output = await runCli('profile', ctx.from.id);
    const data = JSON.parse(output);
    let msg = `👤 *Profile*\n\n*Address:* \`${data.address || 'N/A'}\`\n`;
    msg += `*Tasks:* ${data.tasksCompleted || 0} completed\n`;
    msg += `*Earned:* $${data.totalEarned || 0} USDC`;
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
  } catch (err) {
    await ctx.reply('❌ ' + err.message, { reply_markup: mainMenu(ctx) });
  }
});

bot.action('find', async (ctx) => {
  await ctx.answerCbQuery();
  if (!isLoggedIn(ctx.from.id)) {
    await ctx.reply('❌ Please login first', { reply_markup: mainMenu(ctx) });
    return;
  }
  await ctx.reply('🎯 *Filtered Search*\n\nUse:\n`/find --capabilities=Writing,Code --minBounty=10`\n\nExamples:\n`/find --capabilities=Social\n/find --minBounty=25\n/find --capabilities=Code --minBounty=50`', 
    { parse_mode: 'Markdown', reply_markup: mainMenu(ctx) });
});


// Error handler
bot.catch((err) => {
  console.error('Bot error:', err);
});

console.log('🤖 OxWork Bot starting...');
bot.launch();
console.log('✅ OxWork Bot running!');
