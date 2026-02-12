export type KeywordConfig = {
    word: string;
    is_regex: boolean;
    pattern: RegExp | null;
    display_name: string | null;
};

export type WordGroup = {
    required: KeywordConfig[];
    normal: KeywordConfig[];
    group_key: string;
    display_name: string | null;
    max_count: number;
};

export type ParsedConfig = {
    groups: WordGroup[];
    filter_words: KeywordConfig[];
    global_filters: string[];
};

function parseWord(word: string): KeywordConfig {
    let displayName: string | null = null;
    let wordConfig = word.trim();

    // 1. Parse Display Name (=>)
    if (word.includes('=>')) {
        const parts = word.split('=>');
        wordConfig = parts[0].trim();
        if (parts.length > 1 && parts[1].trim()) {
            displayName = parts[1].trim();
        }
    }

    // 2. Parse Regex
    const regexMatch = wordConfig.match(/^\/(.+)\/([a-z]*)$/i);
    if (regexMatch) {
        const patternStr = regexMatch[1];
        const flags = regexMatch[2];
        try {
            return {
                word: patternStr,
                is_regex: true,
                pattern: new RegExp(patternStr, flags || 'i'),
                display_name: displayName,
            };
        } catch {
            console.warn(`Invalid regex: ${patternStr}`);
        }
    }

    return {
        word: wordConfig,
        is_regex: false,
        pattern: null,
        display_name: displayName,
    };
}

export function parseFrequencyConfig(content: string): ParsedConfig {
    const groupsRaw = content.split(/\n\s*\n/);
    const groups: WordGroup[] = [];
    const filterWords: KeywordConfig[] = [];
    const globalFilters: string[] = [];

    let currentSection = 'WORD_GROUPS';

    for (const groupRaw of groupsRaw) {
        const lines = groupRaw
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith('#'));

        if (lines.length === 0) continue;

        // Check Section
        if (lines[0].startsWith('[') && lines[0].endsWith(']')) {
            const sectionName = lines[0].slice(1, -1).toUpperCase();
            if (['GLOBAL_FILTER', 'WORD_GROUPS'].includes(sectionName)) {
                currentSection = sectionName;
                lines.shift();
            }
        }

        if (currentSection === 'GLOBAL_FILTER') {
            for (const line of lines) {
                if (!['!', '+', '@'].some((p) => line.startsWith(p))) {
                    globalFilters.push(line);
                }
            }
            continue;
        }

        // Process Word Group
        let groupAlias: string | null = null;
        let groupLines = lines;

        if (groupLines.length > 0 && groupLines[0].startsWith('[') && groupLines[0].endsWith(']')) {
            const potentialAlias = groupLines[0].slice(1, -1).trim();
            if (!['GLOBAL_FILTER', 'WORD_GROUPS'].includes(potentialAlias.toUpperCase())) {
                groupAlias = potentialAlias;
                groupLines = groupLines.slice(1);
            }
        }

        const required: KeywordConfig[] = [];
        const normal: KeywordConfig[] = [];
        let maxCount = 0;

        for (const line of groupLines) {
            if (line.startsWith('@')) {
                const count = parseInt(line.slice(1), 10);
                if (!isNaN(count) && count > 0) maxCount = count;
            } else if (line.startsWith('!')) {
                const filter = parseWord(line.slice(1));
                filterWords.push(filter);
            } else if (line.startsWith('+')) {
                required.push(parseWord(line.slice(1)));
            } else {
                normal.push(parseWord(line));
            }
        }

        if (required.length > 0 || normal.length > 0) {
            const groupKey = normal.length > 0
                ? normal.map((w) => w.word).join(' ')
                : required.map((w) => w.word).join(' ');

            let displayName = groupAlias;
            if (!displayName) {
                const parts = [...normal, ...required]
                    .map((w) => w.display_name || w.word)
                    .filter(Boolean);
                displayName = parts.join(' / ');
            }

            groups.push({
                required,
                normal,
                group_key: groupKey,
                display_name: displayName,
                max_count: maxCount,
            });
        }
    }

    return { groups, filter_words: filterWords, global_filters: globalFilters };
}

export const DEFAULT_CONFIG = parseFrequencyConfig(`
[WORD_GROUPS]
/华为|任正非|余承东|鸿蒙|海思|昇腾|鲲鹏|HUAWEI|HarmonyOS|HiSilicon/ => 华为
/比亚迪|王传福|方程豹|腾势|仰望|弗迪|刀片电池|云辇|BYD|Denza|Yangwang/ => 比亚迪
/大疆|汪滔|灵眸|如影|DJI|RoboMaster|Mavic|Zenmuse/ => 大疆
/字节|张一鸣|梁汝波|抖音|ByteDance|TikTok|Douyin|Lark|CapCut/ => 字节跳动
/腾讯|鹅厂|马化腾|微信|QQ|天美|阅文集团|微众银行|Tencent|Pony Ma|WeChat|LightSpeed|WeBank/ => 腾讯
/特斯拉|马斯克|Tesla|Elon Musk|Cybertruck|Model 3|Model Y|Model S|Model X|FSD/ => 特斯拉
/英伟达|黄仁勋|NVIDIA|GeForce|RTX|CUDA|Jensen Huang/ => 英伟达
/微软|Microsoft|Windows|Azure|Satya Nadella|Copilot/ => 微软
/谷歌|皮查伊|安卓|油管|Google|Alphabet|Android|Chrome|YouTube|Gemini|DeepMind|Waymo/ => 谷歌
/苹果|库克|iPhone|iPad|MacBook|iOS|Vision Pro|AirPods|Apple|Tim Cook/ => 苹果
/OpenAI|ChatGPT|Sora|DALL-E|Sam Altman|Greg Brockman/ => OpenAI
`);


export function expandKeyword(keyword: string, config: ParsedConfig): string {
    // Find group that matches this keyword (by display name or logic)
    // For searching, if we select "Huawei", we want "Huawei OR HarmonyOS OR ..."
    const normalized = keyword.toLowerCase().trim();

    for (const group of config.groups) {
        const groupName = group.display_name?.toLowerCase() || '';
        // If selecting the group name, or if the keyword is part of the group
        if (groupName === normalized || group.normal.some(w => w.word.toLowerCase() === normalized)) {
            // Construct OR query from all normal words
            // Note: Convex search syntax is simple, we might need multiple calls or a complex OR
            // For now, let's return a space-separated list which typically means OR in many search engines, 
            // but strictly speaking we might need to handle this closer to the query invocation.
            // Here we return a list of terms.
            const terms = group.normal.map(w => w.word).concat(group.required.map(w => w.word));
            return terms.join(' ');
        }
    }

    return keyword;
}

export function calculateResumeScore(text: string, config: ParsedConfig): { score: number; matches: string[] } {
    let totalScore = 0;
    const lowerText = text.toLowerCase();
    const matchedWords: Set<string> = new Set();

    for (const group of config.groups) {
        // Check required (Weight: 5)
        for (const req of group.required) {
            const isMatch = req.is_regex && req.pattern
                ? req.pattern.test(lowerText)
                : lowerText.includes(req.word.toLowerCase());

            if (isMatch) {
                totalScore += 5;
                matchedWords.add(req.display_name || req.word);
            }
        }

        // Check normal (Weight: 1)
        let normalCount = 0;
        for (const norm of group.normal) {
            const isMatch = norm.is_regex && norm.pattern
                ? norm.pattern.test(lowerText)
                : lowerText.includes(norm.word.toLowerCase());

            if (isMatch) {
                normalCount++;
                matchedWords.add(norm.display_name || norm.word);
            }
        }

        if (group.max_count > 0) {
            normalCount = Math.min(normalCount, group.max_count);
        }
        totalScore += normalCount;
    }

    // Global filters (negative weight? or strict filter? logic says "filters" usually exclude)
    // But here we might just use them as bonus or penalty. 
    // For now, let's keep it simple: sums of positive matches.

    return { score: totalScore, matches: Array.from(matchedWords) };
}
