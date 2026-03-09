require("dotenv").config({ path: __dirname + "/.env" });
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { execSync } = require('child_process');

const API_PROXY = 'https://smartcodedbot.com/api/0xwork';
const STATE_FILE = '/tmp/0xwork-users/alerts-state.json';
const AUTO_CLAIM_TASKS = []; // Tasks to auto-claim when available - DISABLED

// Load state
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (e) {}
  return { lastTaskIds: [], userStatuses: {}, claimedTasks: [] };
}

// Save state
function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}

// Get user Telegram IDs from session dirs
function getUsers() {
  const users = [];
  const baseDir = '/tmp/0xwork-users';
  try {
    if (fs.existsSync(baseDir)) {
      const dirs = fs.readdirSync(baseDir);
      for (const dir of dirs) {
        if (isNaN(dir)) continue;
        const envPath = path.join(baseDir, dir, '.env');
        if (fs.existsSync(envPath)) {
          users.push({ userId: dir });
        }
      }
    }
  } catch (e) {
    console.log('Error reading users:', e.message);
  }
  return users;
}

// Get owner user ID (first logged in user)
function getOwnerUser() {
  const users = getUsers();
  return users.length > 0 ? users[0] : null;
}

// Send Telegram message with inline buttons
async function sendTelegram(userId, message, buttons = null) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  try {
    const payload = {
      chat_id: userId,
      text: message,
      parse_mode: 'Markdown'
    };
    if (buttons) {
      payload.reply_markup = { inline_keyboard: buttons };
    }
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, payload);
    return true;
  } catch (e) {
    console.log(`Failed to notify ${userId}:`, e.message);
    return false;
  }
}

// Get user status from 0xwork CLI
async function getUserStatus(userId) {
  try {
    const output = execSync(`cd /tmp/0xwork-users && 0xwork status`, { encoding: 'utf8' });
    return JSON.parse(output);
  } catch (e) {
    return null;
  }
}

// Claim a task with retry logic
async function claimTask(taskId, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🎯 Claim attempt ${attempt}/${maxRetries} for task #${taskId}...`);
      
      // Wait a bit before each attempt
      if (attempt > 1) {
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }
      
      const output = execSync(`cd /tmp/0xwork-users && 0xwork claim ${taskId}`, { 
        encoding: 'utf8',
        timeout: 30
      });
      
      if (output.includes('"ok":true') || output.includes('Claimed task')) {
        console.log(`✅ Successfully claimed task #${taskId}`);
        return { success: true, output };
      }
      
      // Check if already claimed
      if (output.includes('already claimed') || output.includes('Task not found')) {
        return { success: false, error: 'Task no longer available', output };
      }
      
    } catch (e) {
      console.log(`Attempt ${attempt} failed:`, e.message);
      
      // If it's the last attempt, return failure
      if (attempt === maxRetries) {
        return { success: false, error: e.message };
      }
    }
  }
  
  return { success: false, error: 'Max retries exceeded' };
}

// Check for new tasks - ONLY notify if genuinely new
async function checkNewTasks(state) {
  try {
    const res = await axios.get(`${API_PROXY}/tasks`);
    const tasks = res.data.tasks || [];
    const openTasks = tasks.filter(t => t.status === 'Open');
    
    const currentIds = (openTasks || []).map(t => t.id).sort();
    const previousIds = (state.lastTaskIds || []).sort();
    
    // Find NEW tasks (not in previous list)
    const newIds = currentIds.filter(id => !previousIds.includes(id));
    
    // Only notify if we have previous data AND new tasks
    if (newIds.length > 0 && previousIds.length > 0) {
      console.log(`🎉 Found ${newIds.length} new tasks!`);
      
      const newTasks = openTasks.filter(t => newIds.includes(t.id));
      
      // Notify all users
      const users = getUsers();
      for (const user of users) {
        let msg = `🎉 *New Task${newTasks.length > 1 ? 's' : ''} Available!*\n\n`;
        
        // Build inline buttons for each task
        const buttons = [];
        
        for (const t of newTasks) {
          msg += `⚡ *#${t.chain_task_id}* — $${t.bounty_amount} USDC\n`;
          msg += `   ${t.category}\n\n`;
          
          // Add quick claim button
          buttons.push([
            { text: `⚡ Quick Claim #${t.chain_task_id} ($${t.bounty_amount})`, callback_data: `qclaim:${t.chain_task_id}` }
          ]);
        }
        
        msg += `Tap a button to claim instantly!`;
        await sendTelegram(user.userId, msg, buttons);
      }
      
      // Check for auto-claim tasks
      for (const t of newTasks) {
        if (AUTO_CLAIM_TASKS.includes(t.chain_task_id)) {
          if (!state.claimedTasks.includes(t.chain_task_id)) {
            console.log(`🚀 Auto-claiming task #${t.chain_task_id}!`);
            
            const result = await claimTask(t.chain_task_id);
            
            const user = getOwnerUser();
            if (user) {
              if (result.success) {
                state.claimedTasks.push(t.chain_task_id);
                await sendTelegram(user.userId, 
                  `🚀 *AUTO-CLAIMED Task #${t.chain_task_id}!*\n\n$${t.bounty_amount} USDC\n\nTask is now active!`);
              } else {
                await sendTelegram(user.userId, 
                  `⚠️ *Auto-claim failed for #${t.chain_task_id}*\n\n${result.error}`);
              }
            }
          }
        }
      }
    }
    
    state.lastTaskIds = currentIds;
  } catch (e) {
    console.log('Error checking tasks:', e.message);
  }
  
  return state;
}

// Check user task statuses
// Check user task statuses - notifies ALL users when their tasks are paid
async function checkUserStatuses(state) {
  const users = getUsers();
  
  for (const user of users) {
    try {
      const statusData = await getUserStatus(user.userId);
      if (!statusData) continue;
      
      const prevStatus = state.userStatuses[user.userId] || {};
      const currentStatus = statusData.summary || {};
      
      const submitted = statusData.tasks?.submitted || [];
      const completed = statusData.tasks?.completed || [];
      
      // Check for newly completed tasks (paid!)
      const prevCompleted = prevStatus.completedTasks || [];
      const justCompleted = [];
      for (const task of completed) {
        if (!prevCompleted.includes(task.chainTaskId)) {
          justCompleted.push(task);
          const msg = "💰 *Task #" + task.chainTaskId + " APPROVED!*\n\n";
          msg += "You earned $" + task.bounty + " USDC!\n\n";
          msg += "Total earned: $" + currentStatus.totalEarned;
          
          await sendTelegram(user.userId, msg);
          console.log("💰 User " + user.userId + ": Task #" + task.chainTaskId + " paid! $" + task.bounty);
        }
      }
      
      // If owner task completed, try to auto-claim - DISABLED
      // const ownerUser = getOwnerUser();
      // if (user.userId === ownerUser?.userId && justCompleted.length > 0 && submitted.length === 0) {
      //   console.log("🚀 Owner task completed! Attempting to claim #36...");
      //   
      //   const result = await claimTask(36);
      //   if (result.success) {
      //     state.claimedTasks.push(36);
      //     await sendTelegram(user.userId, 
      //       "🚀 *AUTO-CLAIMED Task #36!*\n\nTask is now active!");
      //   } else {
      //     await sendTelegram(user.userId, 
      //       "⚠️ Could not auto-claim #36: " + result.error);
      //   }
      // }
      
      // Save current status for each user
      state.userStatuses[user.userId] = {
        submitted: submitted.length,
        completed: completed.length,
        completedTasks: completed.map(t => t.chainTaskId),
        totalEarned: currentStatus.totalEarned
      };
      
    } catch (e) {
      // Skip this user on error
    }
  }
  
  return state;
}

// Main loop - check every 5 minutes
async function run() {
  console.log('🔔 Starting 0xWork Alerts Monitor (5 min interval)...');
  console.log(`🎯 Auto-claim tasks: #${AUTO_CLAIM_TASKS.join(', #')}`);
  
  let state = loadState();
  
  // Initial check
  state = await checkNewTasks(state);
  state = await checkUserStatuses(state);
  saveState(state);
  
  // Check every 5 minutes (300000ms)
  setInterval(async () => {
    console.log('🔄 Checking...');
    state = await checkNewTasks(state);
    state = await checkUserStatuses(state);
    saveState(state);
  }, 300000);
  
  console.log('✅ Alerts monitor running! (checking every 5 minutes)');
}

run();
