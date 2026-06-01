import { describe, expect, it } from 'vitest'

import {
  RELATED_EXP_EVIDENCE_CEILINGS,
  resolveRelatedExpEvidenceGate,
} from './related-exp-evidence'

describe('resolveRelatedExpEvidenceGate', () => {
  it('does not apply outside CNC sales target context', () => {
    const result = resolveRelatedExpEvidenceGate({
      target: { keywords: ['CNC'] },
      resume: { ingestData: {} },
    })

    expect(result.applies).toBe(false)
    expect(result.classification).toBe('not_applicable')
    expect(result.ceiling).toBeUndefined()
  })

  it('keeps direct machine-tool sales uncapped', () => {
    const result = resolveRelatedExpEvidenceGate({
      target: { keywords: ['CNC', '销售'] },
      resume: {
        ingestData: {
          evidenceText: '2022-2024 东莞翔亚机械设备有限公司 销售工程师 销售沙迪克慢走丝、火花机、现代威亚CNC数控车床',
          roleSignals: [{
            type: 'sales',
            verifyIn: 'workHistory',
            matchedWorkEntries: [{
              companyName: '东莞翔亚机械设备有限公司',
              jobTitle: '销售工程师',
              years: 2,
              industryVerified: false,
              directRoleMatch: true,
              matchedSignals: ['销售工程师'],
            }],
          }],
        },
      },
    })

    expect(result.applies).toBe(true)
    expect(result.classification).toBe('direct_machine_tool_sales')
    expect(result.ceiling).toBeUndefined()
  })

  it('caps CNC-adjacent spindle sales below the 80 total-score bucket', () => {
    const result = resolveRelatedExpEvidenceGate({
      target: { keywords: ['CNC', '销售'] },
      resume: {
        ingestData: {
          evidenceText: '2020-2024 某主轴公司 销售工程师 负责CNC电主轴销售',
          roleSignals: [{
            type: 'sales',
            verifyIn: 'workHistory',
            matchedWorkEntries: [{
              companyName: '某主轴公司',
              jobTitle: '销售工程师',
              years: 4,
              industryVerified: true,
              directRoleMatch: true,
              matchedSignals: ['销售工程师'],
            }],
          }],
        },
      },
    })

    expect(result.classification).toBe('adjacent_product_sales')
    expect(result.ceiling).toBe(RELATED_EXP_EVIDENCE_CEILINGS.adjacentProductSales)
  })

  it('caps generic industrial sales with no machine-tool domain evidence', () => {
    const result = resolveRelatedExpEvidenceGate({
      target: { keywords: ['CNC', '销售'] },
      resume: {
        ingestData: {
          evidenceText: '2019-2026 基恩士中国有限公司 大客户销售 负责传感器和检测设备销售',
          roleSignals: [{
            type: 'sales',
            verifyIn: 'workHistory',
            matchedSignals: ['销售', '大客户'],
            matchedWorkEntries: [{
              companyName: '基恩士中国有限公司',
              jobTitle: '大客户销售',
              years: 6.75,
              industryVerified: true,
              directRoleMatch: true,
              matchedSignals: ['销售', '大客户'],
            }],
          }],
        },
      },
    })

    expect(result.classification).toBe('direct_sales_without_target_domain')
    expect(result.ceiling).toBe(RELATED_EXP_EVIDENCE_CEILINGS.noTargetDomainSales)
  })

  it('does not treat machine-tool customers as complete machine-tool sales', () => {
    const result = resolveRelatedExpEvidenceGate({
      target: { keywords: ['CNC', '销售'] },
      resume: {
        ingestData: {
          brandHits: [{ brand: '台群', context: 'equipment' }],
          evidenceText: '2024-2026 德力西电气销售有限公司 销售工程师 负责低压电气与变频器销售，推动江苏亚威机床、台群机床供应链品牌入围',
          roleSignals: [{
            type: 'sales',
            verifyIn: 'workHistory',
            matchedWorkEntries: [{
              companyName: '德力西电气销售有限公司',
              jobTitle: '销售工程师',
              years: 1,
              industryVerified: true,
              directRoleMatch: true,
              matchedSignals: ['销售工程师'],
            }],
          }],
        },
      },
    })

    expect(result.classification).toBe('direct_sales_without_target_domain')
    expect(result.ceiling).toBe(RELATED_EXP_EVIDENCE_CEILINGS.noTargetDomainSales)
  })

  it('does not count sales-assistant titles as direct CNC sales', () => {
    const result = resolveRelatedExpEvidenceGate({
      target: { keywords: ['CNC', '销售'] },
      resume: {
        ingestData: {
          evidenceText: '2015-2021 苏州宇鑫精密模具 销售助理 多年CNC操机经验，操作牧野、YASDA机台，部门：CNC操机',
          roleSignals: [{
            type: 'sales',
            verifyIn: 'workHistory',
            matchedWorkEntries: [{
              companyName: '苏州宇鑫精密模具',
              jobTitle: '销售助理',
              years: 6,
              industryVerified: false,
              directRoleMatch: true,
              matchedSignals: ['销售'],
            }],
          }],
        },
      },
    })

    expect(result.classification).toBe('target_domain_without_direct_sales')
    expect(result.ceiling).toBe(RELATED_EXP_EVIDENCE_CEILINGS.noDirectSales)
  })

  it('does not count support-only sales engineer entries as direct machine-tool sales', () => {
    const result = resolveRelatedExpEvidenceGate({
      target: { keywords: ['CNC', '销售'] },
      resume: {
        ingestData: {
          evidenceText: '2010-2026 上海积品精密机械有限公司 销售工程师 公司代理数控机械和数控磨床，工作主要负责机器售后服务、交机、软件培训、客户报修、故障判断和维修管理',
          roleSignals: [{
            type: 'sales',
            verifyIn: 'workHistory',
            matchedWorkEntries: [{
              companyName: '上海积品精密机械有限公司',
              jobTitle: '销售工程师',
              years: 16,
              industryVerified: false,
              directRoleMatch: true,
              matchedSignals: ['销售工程师'],
            }],
          }],
        },
      },
    })

    expect(result.classification).toBe('target_domain_without_direct_sales')
    expect(result.ceiling).toBe(RELATED_EXP_EVIDENCE_CEILINGS.noDirectSales)
  })

  it('treats CNC equipment accessories as adjacent, not complete machine-tool sales', () => {
    const result = resolveRelatedExpEvidenceGate({
      target: { keywords: ['CNC', '销售'] },
      resume: {
        ingestData: {
          evidenceText: '2023-2026 INNA智能装配有限公司 销售工程师 负责CNC设备配套装备销售、CNC电主轴销售与商务谈判',
          roleSignals: [{
            type: 'sales',
            verifyIn: 'workHistory',
            matchedWorkEntries: [{
              companyName: 'INNA智能装配有限公司',
              jobTitle: '销售工程师',
              years: 3,
              industryVerified: false,
              directRoleMatch: true,
              matchedSignals: ['销售工程师'],
            }],
          }],
        },
      },
    })

    expect(result.classification).toBe('adjacent_product_sales')
    expect(result.ceiling).toBe(RELATED_EXP_EVIDENCE_CEILINGS.adjacentProductSales)
  })

  it('keeps verified machine-tool company equipment sales uncapped', () => {
    const result = resolveRelatedExpEvidenceGate({
      target: { keywords: ['CNC', '销售'] },
      resume: {
        ingestData: {
          companyHits: ['深圳市创世纪机械有限公司'],
          evidenceText: '2018-2026 深圳市创世纪机械有限公司 销售工程师 负责公司设备在四川的销售工作，客户洽谈，商务条款沟通，回款和售后维护',
          roleSignals: [{
            type: 'sales',
            verifyIn: 'workHistory',
            matchedWorkEntries: [{
              companyName: '深圳市创世纪机械有限公司',
              jobTitle: '销售工程师',
              years: 8,
              industryVerified: true,
              directRoleMatch: true,
              matchedSignals: ['销售工程师'],
            }],
          }],
        },
      },
    })

    expect(result.classification).toBe('direct_machine_tool_sales')
    expect(result.ceiling).toBeUndefined()
  })

  it('keeps verified machine-tool sales-manager entries uncapped even when they include customer debugging', () => {
    const result = resolveRelatedExpEvidenceGate({
      target: { keywords: ['CNC', '销售'] },
      resume: {
        ingestData: {
          companyHits: ['津上精密机床浙江有限公司'],
          evidenceText: '2016-2018 津上精密机床（浙江）有限公司 销售经理 解决客户加工问题，帮助客户调试产品，主要负责刀塔机车床',
          roleSignals: [{
            type: 'sales',
            verifyIn: 'workHistory',
            matchedWorkEntries: [{
              companyName: '津上精密机床（浙江）有限公司',
              jobTitle: '销售经理',
              years: 2.5,
              industryVerified: true,
              directRoleMatch: true,
              matchedSignals: ['销售经理'],
            }],
          }],
        },
      },
    })

    expect(result.classification).toBe('direct_machine_tool_sales')
    expect(result.ceiling).toBeUndefined()
  })

  it('caps target-domain technical exposure when direct sales is missing', () => {
    const result = resolveRelatedExpEvidenceGate({
      target: { keywords: ['CNC', '销售'] },
      resume: {
        ingestData: {
          evidenceText: '2020-2024 某数控公司 应用工程师 负责CNC调试加工和客户培训',
          roleSignals: [{
            type: 'sales',
            verifyIn: 'workHistory',
            matchedWorkEntries: [{
              companyName: '某数控公司',
              jobTitle: '应用工程师',
              years: 4,
              industryVerified: true,
              directRoleMatch: false,
              matchedSignals: ['配合销售'],
            }],
          }],
        },
      },
    })

    expect(result.classification).toBe('target_domain_without_direct_sales')
    expect(result.ceiling).toBe(RELATED_EXP_EVIDENCE_CEILINGS.noDirectSales)
  })
})
