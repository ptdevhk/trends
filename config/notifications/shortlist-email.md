---
subject: "[候选人推荐] {{jobTitle}} - {{candidateName}} ({{matchScore}}分)"
---

# 新候选人推荐

您好 {{recipientName}}，

系统发现一位高匹配度候选人，推荐给您审阅：

## 候选人信息

| 项目 | 内容 |
|------|------|
| **姓名** | {{candidateName}} |
| **匹配度** | {{matchScore}}分 |
| **工作经验** | {{experience}} |
| **学历** | {{education}} |
| **当前/上一家公司** | {{currentCompany}} |
| **期望薪资** | {{expectedSalary}} |
| **所在地** | {{location}} |

## AI评估报告

### 匹配度评分

{{aiSummary}}

### 推荐等级

**{{aiRecommendation}}**

{{#if matchHighlights}}
### 优势亮点

{{#each matchHighlights}}
- {{this}}
{{/each}}
{{/if}}

{{#if matchConcerns}}
### 需要关注

{{#each matchConcerns}}
- {{this}}
{{/each}}
{{/if}}

{{#if interviewSuggestions}}
## 建议面试问题

{{#each interviewSuggestions}}
{{@index}}. {{this}}
{{/each}}
{{/if}}

## 快速操作

- [📋 查看完整简历]({{detailsUrl}})
- [✅ 加入入围名单]({{actionUrl}}?action=shortlist)
- [📞 标记为待联系]({{actionUrl}}?action=contact)
- [❌ 不合适]({{actionUrl}}?action=reject)

---

此邮件由招聘自动化系统发送。

**职位**: {{jobTitle}}
**时间**: {{timestamp}}

如有问题，请联系 HR 系统管理员。
