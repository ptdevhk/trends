# 新候选人推荐｜{{jobTitle}}

候选人：{{candidateName}}
匹配度：{{matchScore}}分 {{matchStars}}
工作经验：{{experience}}
学历：{{education}}
期望薪资：{{expectedSalary}}
所在地：{{location}}

AI评估：
{{aiSummary}}

推荐等级：{{aiRecommendation}}

{{#if matchHighlights}}
优势亮点：
{{#each matchHighlights}}
- {{this}}
{{/each}}
{{/if}}

{{#if matchConcerns}}
需要关注：
{{#each matchConcerns}}
- {{this}}
{{/each}}
{{/if}}

查看详情：{{detailsUrl}}
入围：{{actionUrl}}?action=shortlist
拒绝：{{actionUrl}}?action=reject

时间：{{timestamp}}
