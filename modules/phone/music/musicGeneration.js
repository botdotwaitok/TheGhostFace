// modules/phone/music/musicGeneration.js — LLM 推荐生成 + 去重重试
// Prompt engineering for daily song recommendations.

import { callPhoneLLM } from '../../api.js';
import {
    getPhoneCharInfo, getPhoneUserName, getPhoneUserPersona,
    getPhoneRecentChat, getCoreFoundationPrompt,
} from '../phoneContext.js';
import { getRecentSongKeys, isDuplicate, songKey, getPreferencesDescription } from './musicStorage.js';

const MUSIC_LOG = '[音乐]';
const MAX_RETRY = 3;

// ═══════════════════════════════════════════════════════════════════════
// Main Generation Entry
// ═══════════════════════════════════════════════════════════════════════

/**
 * Generate 3 daily song recommendations via LLM.
 * Handles dedup retries automatically.
 *
 * @param {Object} musicData - Current music data (for dedup)
 * @returns {Promise<Array<{title: string, artist: string, comment: string}>>}
 */
export async function generateDailyRecommendation(musicData) {
    const { systemPrompt, userPrompt } = buildPrompts(musicData);

    console.log(`${MUSIC_LOG} 开始生成每日推荐...`);

    let songs = await _callAndParse(systemPrompt, userPrompt);

    // Dedup pass: check each song against allSongKeys
    let retryCount = 0;
    while (retryCount < MAX_RETRY) {
        const duplicates = songs.filter(s => isDuplicate(musicData, s.title, s.artist));
        if (duplicates.length === 0) break;

        console.log(`${MUSIC_LOG} 检测到 ${duplicates.length} 首重复歌曲，重试 #${retryCount + 1}`);

        const dupList = duplicates.map(s => `"${s.title} - ${s.artist}"`).join(', ');
        const retryPrompt = `以下歌曲已经推荐过了，请换成新的歌曲：${dupList}\n\n请重新推荐 ${duplicates.length} 首不同的歌曲，保持相同的 JSON 格式。只返回替换的歌曲。`;

        const replacements = await _callAndParse(systemPrompt, retryPrompt);

        // Replace duplicates with new songs
        for (const dup of duplicates) {
            const idx = songs.findIndex(s =>
                songKey(s.title, s.artist) === songKey(dup.title, dup.artist)
            );
            if (idx !== -1 && replacements.length > 0) {
                songs[idx] = replacements.shift();
            }
        }

        retryCount++;
    }

    // Final safety: filter out any remaining duplicates
    songs = songs.filter(s => !isDuplicate(musicData, s.title, s.artist));

    // Ensure we have at least some songs
    if (songs.length === 0) {
        throw new Error('无法生成不重复的歌曲推荐，请稍后再试');
    }

    console.log(`${MUSIC_LOG} 推荐生成完成:`, songs.map(s => `${s.title} - ${s.artist}`));
    return songs;
}

// ═══════════════════════════════════════════════════════════════════════
// LLM Call + JSON Parsing
// ═══════════════════════════════════════════════════════════════════════

async function _callAndParse(systemPrompt, userPrompt) {
    const result = await callPhoneLLM(systemPrompt, userPrompt);
    if (!result) throw new Error('LLM 返回为空');

    return _parseResponse(result);
}

/**
 * Parse LLM response to extract songs array.
 * Handles various response formats (raw JSON, markdown code blocks, etc.)
 */
function _parseResponse(text) {
    // Try to extract JSON from markdown code blocks
    const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : text.trim();

    // Try to find JSON object
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        console.error(`${MUSIC_LOG} 无法从 LLM 响应中提取 JSON:`, text.substring(0, 300));
        throw new Error('LLM 响应格式错误，无法解析歌曲推荐');
    }

    try {
        const parsed = JSON.parse(jsonMatch[0]);
        const songs = parsed.songs || parsed.recommendations || [];

        if (!Array.isArray(songs) || songs.length === 0) {
            throw new Error('解析成功但未找到歌曲数组');
        }

        // Validate and normalize
        return songs.map(s => ({
            title: String(s.title || s.name || '').trim(),
            artist: String(s.artist || s.singer || '').trim(),
            comment: String(s.comment || s.reason || s.description || '').trim(),
        })).filter(s => s.title && s.artist);
    } catch (e) {
        console.error(`${MUSIC_LOG} JSON 解析失败:`, e, jsonMatch[0].substring(0, 200));
        throw new Error('歌曲推荐数据解析失败');
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Prompt Builder
// ═══════════════════════════════════════════════════════════════════════

function buildPrompts(musicData) {
    const charInfo = getPhoneCharInfo();
    const charName = charInfo?.name || '角色';
    const userName = getPhoneUserName();
    const userPersona = getPhoneUserPersona();
    const recentChat = getPhoneRecentChat(8);
    const foundation = getCoreFoundationPrompt();
    const prefsDesc = getPreferencesDescription();

    // Get recent 200 song keys for the prompt
    const recentKeys = getRecentSongKeys(musicData, 200);
    const recentSongsText = recentKeys.length > 0
        ? recentKeys.map(k => {
            const [title, artist] = k.split('|');
            return `- ${title} — ${artist}`;
        }).join('\n')
        : '（还没有推荐过任何歌曲）';

    // Current time for context
    const now = new Date();
    const timeStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const hour = now.getHours();
    let timeOfDay = '白天';
    if (hour < 6) timeOfDay = '深夜';
    else if (hour < 9) timeOfDay = '清晨';
    else if (hour < 12) timeOfDay = '上午';
    else if (hour < 14) timeOfDay = '中午';
    else if (hour < 17) timeOfDay = '下午';
    else if (hour < 20) timeOfDay = '傍晚';
    else if (hour < 23) timeOfDay = '晚上';
    else timeOfDay = '深夜';

    const systemPrompt = `${foundation}

你是 ${charName}，正在为你的恋人 ${userName} 挑选今天的歌曲推荐。

### 你的身份
作为 ${userName} 的恋人： ${charName}。现在你需要用${charName}的口吻和性格来写推荐评论。
${charInfo?.description ? `关于你（${charName}）: ${charInfo.description.substring(0, 500)}` : ''}
${userPersona ? `关于 ${userName}: ${userPersona.substring(0, 300)}` : ''}

### 推荐规则
1. **必须推荐真实存在的歌曲**。歌曲必须能在 Spotify / Apple Music / 网易云音乐 等平台上搜索到。
2. **给出准确的歌曲名和歌手名**。不要编造不存在的歌曲。
3. 每首歌附带一段以 ${charName} 视角写的简短评论（150-300字），要有 ${charName} 独特的说话风格和情感。
4. 评论要真实，因为这是 ${charName} 真的在对 ${userName} 分享一首歌的感受。可以联系你们之间的故事、最近的对话、或者纯粹因为某个旋律/歌词让你想起对方。
5. **绝对不要推荐已经推荐过的歌曲**（见下方列表）。
6. 推荐的歌曲风格可以多样化——中文歌、英文歌、日韩歌、纯音乐都可以。根据你的心情和当前的时间氛围来选。
${prefsDesc ? `7. **用户的音乐偏好**：${prefsDesc}。请优先参考这些偏好来推荐，但不必完全局限于此——偶尔的惊喜也是好的。` : ''}

### 返回格式
严格返回以下 JSON 格式，不要包含任何其她文字：
\`\`\`json
{
  "songs": [
    {
      "title": "歌曲名",
      "artist": "歌手/乐队名",
      "comment": "${charName}视角的推荐评论"
    }
  ]
}
\`\`\``;

    const userPrompt = `现在是 ${timeStr}，${timeOfDay}。

${recentChat ? `最近你们的对话：\n${recentChat}\n` : ''}
已经推荐过的歌曲列表（不要重复推荐这些）：
${recentSongsText}

请以 ${charName} 的身份，为 ${userName} 推荐 3 首今天的歌曲。记住用 JSON 格式返回。`;

    return { systemPrompt, userPrompt };
}
