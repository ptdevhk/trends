const fs = require('fs');
const _ = require('lodash');
const path = require('path');

const newKeys = {
    "common": {
        "reset": "重置"
    },
    "resumes": {
        "status": {
            "options": {
                "new": "新候选人",
                "contacted": "已联系",
                "interviewing": "面试中",
                "interviewed_pass": "面试通过",
                "interviewed_reject": "面试淘汰",
                "offer": "已发 Offer",
                "hired": "已入职",
                "withdrawn": "已放弃"
            }
        },
        "searchPage": {
            "facets": {
                "filtersTitle": "筛选条件",
                "filtersDescription": "在当前搜索结果中进一步精确筛选。",
                "filtersDescriptionMobile": "在当前搜索结果中进一步精确筛选。",
                "emptyLabel": "暂无可用选项",
                "showLess": "收起",
                "showMore": "展开剩余 {{count}} 项",
                "experienceLevel": "工作经验",
                "experience": {
                    "senior": "资深",
                    "mid": "中级",
                    "junior": "初级"
                },
                "skillClusters": "技能图谱",
                "tags": "标签聚类",
                "companies": "公司经历",
                "education": "学历",
                "status": "候选人状态",
                "matchScore": "匹配分"
            }
        }
    }
};

const newKeysEn = {
    "common": {
        "reset": "Reset"
    },
    "resumes": {
        "status": {
            "options": {
                "new": "New",
                "contacted": "Contacted",
                "interviewing": "Interviewing",
                "interviewed_pass": "Interview Passed",
                "interviewed_reject": "Interview Rejected",
                "offer": "Offer Extended",
                "hired": "Hired",
                "withdrawn": "Withdrawn"
            }
        },
        "searchPage": {
            "facets": {
                "filtersTitle": "Filters",
                "filtersDescription": "Refine your search results.",
                "filtersDescriptionMobile": "Refine your search results.",
                "emptyLabel": "No options available",
                "showLess": "Show less",
                "showMore": "Show {{count}} more",
                "experienceLevel": "Experience",
                "experience": {
                    "senior": "Senior",
                    "mid": "Mid",
                    "junior": "Junior"
                },
                "skillClusters": "Skill Clusters",
                "tags": "Tags",
                "companies": "Companies",
                "education": "Education",
                "status": "Candidate Status",
                "matchScore": "Match Score"
            }
        }
    }
};

const newKeysHant = {
    "common": {
        "reset": "重置"
    },
    "resumes": {
        "status": {
            "options": {
                "new": "新候選人",
                "contacted": "已聯絡",
                "interviewing": "面試中",
                "interviewed_pass": "面試通過",
                "interviewed_reject": "面試淘汰",
                "offer": "已發 Offer",
                "hired": "已入職",
                "withdrawn": "已放棄"
            }
        },
        "searchPage": {
            "facets": {
                "filtersTitle": "篩選條件",
                "filtersDescription": "在當前搜索結果中進一步精確篩選。",
                "filtersDescriptionMobile": "在當前搜索結果中進一步精確篩選。",
                "emptyLabel": "暫無可用選項",
                "showLess": "收起",
                "showMore": "展開剩餘 {{count}} 項",
                "experienceLevel": "工作經驗",
                "experience": {
                    "senior": "資深",
                    "mid": "中級",
                    "junior": "初級"
                },
                "skillClusters": "技能圖譜",
                "tags": "標籤聚類",
                "companies": "公司經歷",
                "education": "學歷",
                "status": "候選人狀態",
                "matchScore": "匹配分"
            }
        }
    }
};

function updateLocales() {
    const dir = path.join(__dirname, 'apps/web/src/i18n/locales');
    const locales = [
        { file: 'zh-Hans.json', newVals: newKeys },
        { file: 'zh-Hant.json', newVals: newKeysHant },
        { file: 'en.json', newVals: newKeysEn }
    ];

    for (const { file, newVals } of locales) {
        const filePath = path.join(dir, file);
        if (!fs.existsSync(filePath)) {
            console.log(`Skipping missing file: ${file}`);
            continue;
        }
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        _.merge(data, newVals);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
        console.log(`Updated ${file}`);
    }
}

updateLocales();
