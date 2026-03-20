import { describe, expect, it } from "vitest";

import {
  isLikelyManual51jobCompanyName,
  isLikelyManual51jobJobTitle,
  parse51jobManualResume,
} from "../resume-normalization";

describe("resume-normalization manual 51job", () => {
  it("does not promote narrative fragments into companyName", () => {
    const text = [
      "王先生",
      "工作经历",
      "2018.05 - 2020.11（2年6个月）",
      "职位：销售代表",
      "工作描述：",
      "在该公司主要负责以电话开发客户，然后通过线上交流沟通，线下上门拜访客户的方式来完成与客户的合作。",
      "长沙冠聚信息技术有限公司",
      "2017.06 - 2018.01（7个月）",
      "职位：电话销售",
      "工作描述：通过公司提供的客户资源进行电话联系，开发意向客户。",
    ].join("\n");

    const parsed = parse51jobManualResume({ text });

    expect(parsed.workHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({
        companyName: "长沙冠聚信息技术有限公司",
        jobTitle: "销售代表",
        startDate: "2018-05",
        endDate: "2020-11",
      }),
      expect.objectContaining({
        jobTitle: "电话销售",
        startDate: "2017-06",
        endDate: "2018-01",
      }),
    ]));

    expect(parsed.workHistory.some((entry) => entry.companyName === "在该公司")).toBe(false);
    expect(parsed.workHistory.some((entry) => entry.companyName === "通过公司")).toBe(false);
  });

  it("does not treat duration lines as job titles or generic nouns as companies", () => {
    const text = [
      "工作经历",
      "加工中心 2025.05-2025.07（2个月）",
      "2022.01-2025.04（3年3个月）",
    ].join("\n");

    const parsed = parse51jobManualResume({ text });

    expect(parsed.workHistory.some((entry) => entry.companyName === "加工中心")).toBe(false);
    expect(parsed.workHistory.some((entry) => entry.jobTitle === "2025.05-2025.07 2个月")).toBe(false);
    expect(parsed.workHistory.some((entry) => typeof entry.jobTitle === "string" && /\d{4}/u.test(entry.jobTitle))).toBe(false);
  });

  it("rejects placeholder company and project labels when parsing manual 51job work history", () => {
    const text = [
      "工作经历",
      "2019.03 - 2019.06",
      "所属公司：",
      "广州惠挺和数控设备有限公司",
      "项目描述：",
      "新能源汽车空调缸体缸盖机器人自动化生产线交钥匙项目",
      "9台哈挺车床9台哈挺加工中心6台fanuc机器人2台桁架机器人配合自动化年产35万台压缩机调试",
    ].join("\n");

    const parsed = parse51jobManualResume({ text });

    expect(parsed.workHistory).toEqual([
      expect.objectContaining({
        companyName: "广州惠挺和数控设备有限公司",
        description: "新能源汽车空调缸体缸盖机器人自动化生产线交钥匙项目 9台哈挺车床9台哈挺加工中心6台fanuc机器人2台桁架机器人配合自动化年产35万台压缩机调试",
        startDate: "2019-03",
        endDate: "2019-06",
      }),
    ]);
    expect(parsed.workHistory[0]?.jobTitle).toBeUndefined();
  });

  it("drops timeline-only placeholder blocks instead of keeping 项目经验 or 走心机 as structured work entries", () => {
    const text = [
      "工作经历",
      "2022.02-至今（4年1个月）",
      "走心机",
      "2019.06-至今（6年9个月）",
      "项目经验",
    ].join("\n");

    const parsed = parse51jobManualResume({ text });

    expect(parsed.workHistory).toEqual([]);
  });

  it("does not promote real project-company lines into job titles", () => {
    const text = [
      "赖先生",
      "工作经历",
      "哈挺机床（上海）有限公司",
      "2021.09 - 至今（4年2个月）",
      "机械/设备/重工 ｜ 150-500人 ｜ 外资（欧美）",
      "职位：销售经理",
      "工作描述：",
      "主要负责哈挺机床在华南区域的销售工作，",
      "1.定期客户拜访，技术交流，订单获取，技术支持，订单跟进，货款收回，",
      "2.经销商的销售支持，机床选型、节拍计算、客户拜访、技术交流、产品打样和工艺方案！帮助经销商完成销售目标",
      "广州数控设备有限公司",
      "2019.07 - 至今（6年4个月）",
      "机械/设备/重工 ｜ 1000-5000人 ｜ 民营",
      "职位：IT技术支持",
      "工作描述：",
      "1、负责广东省（广州部、佛山部、东深部、江珠部）20多位销售经理及代理商的技术支持工作如下：对客户提供的图纸和产品，做技术分析，出加工工艺方案，机床选型，客户拜访、技术交流、产品打样、案例报告等",
      "2、负责机床事业部自动化交钥匙工程机床选型、出加工方案、编程加工、交付、培训（三条自动化产线项目、含一条军工产线项目）",
      "3、负责广东省（深圳展、中山展、珠海展、江门展、佛山展）各展会机床布展、现场加工样件、机床产品特点推广等",
      "广州惠挺和数控设备有限公司",
      "2017.03 - 2019.07（2年4个月）",
      "机械/设备/重工 ｜ 少于50人 ｜ 民营",
      "职位：售前技术支持经理/主管",
      "工作描述：",
      "主要负责美国哈挺机床在华南地区的售前及售后服务；",
      "1.负责（广东、广西、江西、湖南、湖北）8位销售经理及代理商的技术支持工作如下：机床选型、节拍计算、客户拜访、技术交流、产品打样和工艺方案！",
      "2.负责售后技术服务：对客户进行机床、系统操作、数控编程、机床维修保养培训，设备故障维修等",
      "3. 负责过3个以上客户交钥匙工程（包含两个汽车零配件行业自动化上下料项目）：从调试机床-产品加工-CPK验收-培训交付",
      "4.通过电话或现场支持，为客户解决设备、加工出现的问题，包括保内设备的故障维修，保外设备的故障维修等；",
      "卡尔蔡司（广州）太阳镜片有限公司",
      "2014.05 - 2017.03（2年10个月）",
      "机械/设备/重工 ｜ 50-150人 ｜ 外资（欧美）",
      "职位：高级技术员",
      "工作描述：",
      "负责厂内机床设备维修、保养、；",
      "1.空压机，空调，冷水机，注塑机，镀膜机，超声波清洗线，等设备维修保养；",
      "2.配合生产部门制造工装夹具（solidworks ,autocad）设计及加工（车 铣 磨 钳 焊）；",
      "3.编制年、季、月度设备预检计划、设备大中修计划、备件库存和供应计划；",
      "广州市腾马机电设备有限公司",
      "2009.10 - 2013.12（4年2个月）",
      "机械/设备/重工 ｜ 少于50人 ｜ 民营",
      "职位：CNC/数控编程",
      "工作描述：",
      "主要负责工厂机械零件加工生产；",
      "1.熟练使用普通车床数控车床加工及编程；",
      "2.熟练使用普通铣床和数控加工中心操作和编程；",
      "3.熟练使用cad  mastercam  solidworks等软件；",
      "4.有电工证、焊工证、高压电工证、有多年的机械加工工作经验，熟悉机械加工工艺和材料特性；",
      "项目经验",
      "柳州光裕新能源汽车空调有限公司",
      "2019.03 - 2019.06",
      "所属公司：",
      "广州惠挺和数控设备有限公司",
      "项目描述：",
      "新能源汽车空调缸体缸盖机器人自动化生产线交钥匙项目",
      "9台哈挺车床9台哈挺加工中心6台fanuc机器人2台桁架机器人配合自动化年产35万台压缩机调试",
      "教育经历",
    ].join("\n");

    const parsed = parse51jobManualResume({ text });
    const projectEntry = parsed.workHistory.find((entry) => entry.startDate === "2019-03" && entry.endDate === "2019-06");

    expect(parsed.workHistory).toHaveLength(6);
    expect(projectEntry).toEqual(expect.objectContaining({
      companyName: "广州惠挺和数控设备有限公司",
      description: "新能源汽车空调缸体缸盖机器人自动化生产线交钥匙项目 9台哈挺车床9台哈挺加工中心6台fanuc机器人2台桁架机器人配合自动化年产35万台压缩机调试",
      startDate: "2019-03",
      endDate: "2019-06",
    }));
    expect(projectEntry?.jobTitle).toBeUndefined();
  });

  it("keeps 主要客户 lines in descriptions without promoting client companies into employers", () => {
    const text = [
      "工作经历",
      "2007.08 - 2014.03（6年7个月）",
      "职位：销售总监",
      "工作描述：",
      "主要销售日系，加工中心，车床，磨床，如日本泷泽，日本高松，兄弟机，法那科，LGMAZAK。",
      "工作内容：1，新客户业务开发",
      "主要客户：",
      "肇庆本田金属有限公司，日立汽车系统部件（广州）有限公司",
      "珠海松下马达有限公司，电装（广州南沙）有限公司",
    ].join("\n");

    const parsed = parse51jobManualResume({ text });

    expect(parsed.workHistory).toEqual([
      expect.objectContaining({
        jobTitle: "销售总监",
        description: expect.stringContaining("主要客户 肇庆本田金属有限公司"),
        startDate: "2007-08",
        endDate: "2014-03",
      }),
    ]);
    expect(parsed.workHistory[0]?.description).toContain("珠海松下马达有限公司");
    expect(parsed.workHistory[0]?.description).toContain("电装 广州南沙 有限公司");
    expect(parsed.workHistory[0]?.companyName).toBeUndefined();
  });

  it("does not invent missing employers from 应聘公司 headers or customer lists", () => {
    const text = [
      "应聘职位：车床销售工程师（东莞）",
      "应聘公司：宝力机械有限公司",
      "应聘时间：2025.06.03 - 活跃时间：2025.06.03",
      "ID：265281996",
      "仅供招聘专用，企业应尽保密义务，禁止外传",
      "谷仍友",
      "积极找工作（一个月内到岗）",
      "男 ｜ 42岁 ｜ 现居·广州-番禺区 ｜ 18年工作经验",
      "工作经历",
      "广州市振工机电设备有限公司",
      "2014.05 - 至今（11年1个月）",
      "职位：销售总监",
      "工作描述：",
      "主要销售日本津上数控车床，数控走心机，加工中心，外圆磨床，机床周边，刀柄，刀具，切削液销售。",
      "主要客户：",
      "广汽乘用车有限公司",
      "汤浅商事（上海）有限公司广州公司",
      "2007.08 - 2014.03（6年7个月）",
      "机械/设备/重工 ｜ 少于50人 ｜ 外资（非欧美）",
      "职位：销售总监",
      "工作描述：",
      "主要销售日系，加工中心，车床，磨床，如日本泷泽，日本高松，兄弟机，法那科，LGMAZAK。",
      "工作内容：1，新客户业务开发",
      "主要客户：",
      "肇庆本田金属有限公司，日立汽车系统部件（广州）有限公司",
      "珠海松下马达有限公司，电装（广州南沙）有限公司",
      "教育经历",
    ].join("\n");

    const parsed = parse51jobManualResume({ text });

    expect(parsed.workHistory).toEqual([
      expect.objectContaining({
        companyName: "广州市振工机电设备有限公司",
        jobTitle: "销售总监",
        startDate: "2014-05",
        endDate: "至今",
      }),
      expect.objectContaining({
        jobTitle: "销售总监",
        description: expect.stringContaining("主要客户 肇庆本田金属有限公司"),
        startDate: "2007-08",
        endDate: "2014-03",
      }),
    ]);
    expect(parsed.workHistory[1]?.companyName).toBeUndefined();
    expect(parsed.workHistory.some((entry) => entry.companyName === "宝力机械有限公司")).toBe(false);
    expect(parsed.workHistory.some((entry) => entry.companyName === "肇庆本田金属有限公司")).toBe(false);
    expect(parsed.workHistory.some((entry) => entry.companyName === "汤浅商事（上海）有限公司广州公司")).toBe(false);
  });

  it("rejects placeholder labels as likely company or job title candidates", () => {
    expect(isLikelyManual51jobCompanyName("所属公司")).toBe(false);
    expect(isLikelyManual51jobCompanyName("走心机")).toBe(false);
    expect(isLikelyManual51jobJobTitle("项目描述：")).toBe(false);
    expect(isLikelyManual51jobJobTitle("项目经验")).toBe(false);
    expect(isLikelyManual51jobJobTitle("1.安排产品工艺流程;")).toBe(false);
    expect(isLikelyManual51jobJobTitle("2年")).toBe(false);
  });

  it("drops dated education or placeholder-only blocks from work history", () => {
    const text = [
      "工作经历",
      "2003.09-2007.07",
      "按全日制国家标准所有机械类课程均有学习。",
      "英语 简单沟通/读写",
      "小车驾驶证 2006.12-2007.07",
      "培训机构： 佛山市力和驾校 培训地点： 佛山",
      "项目经验",
      "2008.09-2012.04（3年7个月）",
      "加工",
    ].join("\n");

    const parsed = parse51jobManualResume({ text });

    expect(parsed.workHistory).toEqual([]);
  });

  it("ignores repeated recruiter-company boilerplate before the real work entry", () => {
    const text = [
      "工作经历",
      "2013.08-2017.03（3年7个月）",
      "广州宝力机械科技有限公司东莞分公司",
      "广州宝力机械科技有限公司东莞分公司",
      "广州宝力机械科技有限公司东莞分公司",
      "广州宝力机械科技有限公司东莞分公司",
      "聊",
      "天",
      "声明：以上人才信息仅供广州宝力机械科技有限公司东莞分公司招聘使用，禁止用于其他任何用途。",
      "一经发现我司有权采取一切必要措施，包括但不限于暂停或终止服务。",
      "封改造项目跟进。",
      "广州机械科学研究院 客服专员/助理",
      "机械/设备/重工 | 500-1000人 | 国企",
      "连接客户、销售、技术、生产之间的桥梁和纽带；",
    ].join("\n");

    const parsed = parse51jobManualResume({ text });

    expect(parsed.workHistory).toEqual([
      expect.objectContaining({
        companyName: "广州机械科学研究院",
        jobTitle: "客服专员/助理",
        startDate: "2013-08",
        endDate: "2017-03",
      }),
    ]);
  });

  it("dedupes repeated work entries and keeps the richer one", () => {
    const text = [
      "工作经历",
      "深圳中扬数控科技有限公司",
      "2022.12 - 2024.05（1年5个月）",
      "机械/设备/重工",
      "职位：销售经理",
      "工作描述：",
      "在中扬数控有着不错的业绩，T6钻攻机，车铣复合机，龙门加工中心，都有出机！",
      "深圳中扬数控科技有限公司",
      "2022.12 - 2024.05（1年5个月）",
      "机械/设备/重工",
      "职位：销售经理",
      "工作描述：",
      "工作描述:",
      "在中扬数控有着不错的业绩,T6钻攻机,车铣复合机,龙门加工中心,都有出机!",
    ].join("\n");

    const parsed = parse51jobManualResume({ text });

    expect(parsed.workHistory.filter((entry) => entry.startDate === "2022-12" && entry.endDate === "2024-05")).toHaveLength(1);
    expect(parsed.workHistory[0]).toEqual(expect.objectContaining({
      companyName: "深圳中扬数控科技有限公司",
      jobTitle: "销售经理",
      startDate: "2022-12",
      endDate: "2024-05",
    }));
  });

  it("starts a new work block when the next employer line trails the previous description", () => {
    const text = [
      "工作经历",
      "蓝思仪器有限公司",
      "2025.02 - 2025.06（4个月）",
      "医疗设备/器械 ｜ 50-150人 ｜ 民营",
      "职位：销售工程师",
      "工作描述：",
      "对门窗体验箱和气密性仪器进行销售。",
      "通过线上线下的不同渠道，来了解客户的需求，进行对客户的推销",
      "湖南中南智能装备有限公司",
      "2021.09 - 2024.09（3年）",
      "汽车研发/制造 ｜ 150-500人 ｜ 国企",
      "职位：数控车床编程",
      "工作描述：",
      "根据工艺图纸进行基础要求加工，",
      "运用不同的编程程序应用，",
      "来配合不同的零件加工与测量，",
      "最后达到工艺图纸的要求。",
    ].join("\n");

    const parsed = parse51jobManualResume({ text });

    expect(parsed.workHistory).toEqual([
      expect.objectContaining({
        companyName: "蓝思仪器有限公司",
        jobTitle: "销售工程师",
        startDate: "2025-02",
        endDate: "2025-06",
      }),
      expect.objectContaining({
        companyName: "湖南中南智能装备有限公司",
        jobTitle: "数控车床编程",
        startDate: "2021-09",
        endDate: "2024-09",
      }),
    ]);
    expect(parsed.workHistory[0]?.description).not.toContain("湖南中南智能装备有限公司");
  });

  it("splits real trailing employer lines from manual 51job exports", () => {
    const text = [
      "工作经历",
      "深圳市金承诺实业有限公司",
      "2021.03 - 至今（5年）",
      "机械/设备/重工",
      "职位：销售工程师",
      "工作描述：",
      "1、负责进口刀具:山特维克，伊斯卡，瓦尔特，肯纳、油品:嘉实多，好富顿，福斯，及机床:马扎克、等产品的销售工作，积极开拓市场，开发新客户，同时维护公司老客户，确保客户关系稳定。",
      "2、任职4年多期间，每年均超额完成公司设定的销售目标，展现出优秀的销售能力和业绩表现。",
      "3、成功维护稳定合作客户超过10家，其中年销售额超100万的中大型客户达2家，为公司带来持续稳定的收入来源。",
      "金合钻石刀具（深圳）有限公司",
      "2016.07 - 2021.02（4年7个月）",
      "汽车零部件",
      "职位：销售专员",
      "工作描述：",
      "1. 2016-2019年负责CNC数控编程与操机、CAD绘图及加工方案设计，熟练掌握五轴数控磨床编程及操机技术，2018年底升任部门生产主管。",
      "2. 2019-2021年专注非标刀具销售，针对3C行业自主开发市场，2020年起每年刀具销售额200万以上，超额达成公司目标，独立开发并维护2家大客户及10多家中型客户。",
      "教育经历",
    ].join("\n");

    const parsed = parse51jobManualResume({ text });

    expect(parsed.workHistory).toEqual([
      expect.objectContaining({
        companyName: "深圳市金承诺实业有限公司",
        jobTitle: "销售工程师",
        startDate: "2021-03",
        endDate: "至今",
      }),
      expect.objectContaining({
        companyName: "金合钻石刀具（深圳）有限公司",
        jobTitle: "销售专员",
        startDate: "2016-07",
        endDate: "2021-02",
      }),
    ]);
    expect(parsed.workHistory[0]?.description).not.toContain("金合钻石刀具（深圳）有限公司");
  });

  it("dedupes project-augmented duplicates from real manual 51job exports", () => {
    const text = [
      "工作经历",
      "东莞汇振精密机械有限公司",
      "2021.04 - 2023.04（2年）",
      "机械/设备/重工 ｜ 少于50人 ｜ 民营",
      "职位：销售",
      "工作描述：",
      "在职期间，自主开发成交客户，维护成交客户。对精密模具，医疗零配件，汽车零配件客户等行业知名客户都有跟进成交（深圳市金大智能有限公司，东莞市达旺精密模具有限公司等），对进出口设备（牧野，罗德斯，雅思达，马扎克）机型和性能有一定了解   （本人有车）",
      "东莞市新法拉数控设备有限公司",
      "2018.01 - 2021.03（3年2个月）",
      "机械/设备/重工 ｜ 50-150人 ｜ 民营",
      "职位：销售经理",
      "工作描述：",
      "主要销售加工中心和加工中心，主要面对佛山片区业务，跟进开发所有佛山客户的成交，设备维护。",
      "广东凌盛科技有限公司",
      "2017.01 - 2018.03（1年2个月）",
      "计算机服务(系统、数据服务、维修) ｜ 少于50人 ｜ 民营",
      "职位：销售代表",
      "工作描述：",
      "通过电话销售向客户介绍我司产品 提升客户排名 增加单品手淘流量",
      "项目经验",
      "手机淘宝推广",
      "2017.01 - 2018.03",
      "所属公司：",
      "广东凌盛科技有限公司",
      "项目描述：",
      "通过电话销售手淘流量 手淘排行",
      "教育经历",
    ].join("\n");

    const parsed = parse51jobManualResume({ text });

    expect(parsed.workHistory).toEqual([
      expect.objectContaining({
        companyName: "东莞汇振精密机械有限公司",
        jobTitle: "销售",
        startDate: "2021-04",
        endDate: "2023-04",
      }),
      expect.objectContaining({
        companyName: "东莞市新法拉数控设备有限公司",
        jobTitle: "销售经理",
        startDate: "2018-01",
        endDate: "2021-03",
      }),
      expect.objectContaining({
        companyName: "广东凌盛科技有限公司",
        jobTitle: "销售代表",
        startDate: "2017-01",
        endDate: "2018-03",
      }),
    ]);
    expect(parsed.workHistory).toHaveLength(3);
  });

  it("strips employer type prefixes before inferring job titles", () => {
    const text = [
      "工作经历",
      "2007.07-2009.07（2年）",
      "米思米（中国）精密机械贸易有限公司 台资企业",
      "教育经历",
    ].join("\n");

    const parsed = parse51jobManualResume({ text });

    expect(parsed.workHistory).toEqual([
      expect.objectContaining({
        companyName: "米思米（中国）精密机械贸易有限公司",
        startDate: "2007-07",
        endDate: "2009-07",
      }),
    ]);
    expect(parsed.workHistory[0]?.jobTitle).toBeUndefined();
  });

  it("falls back to 岗位经验 blocks when 工作经历 only contains placeholders", () => {
    const text = [
      "工作经历",
      "2022.02-至今（4年1个月）",
      "走心机",
      "岗位经验",
      "东莞市世川机械科技有限公司 客户代表",
      "机械/设备/重工 | 少于50人 | 民营",
      "1.主要负责销售津上设备，车床，加工中心。",
      "教育经历",
    ].join("\n");

    const parsed = parse51jobManualResume({ text });

    expect(parsed.workHistory).toEqual([
      expect.objectContaining({
        companyName: "东莞市世川机械科技有限公司",
        jobTitle: "客户代表",
      }),
    ]);
  });

  it("rebuilds work history from 岗位经验 when only timeline placeholders are stored under 工作经历", () => {
    const text = [
      "工作经历",
      "2022.02-至今（4年1个月）",
      "走心机",
      "2020.02-2021.12（1年10个月）",
      "东莞莞建强有限公司 客户代表",
      "2017.02-2020.09（3年7个月）",
      "广东大川机械有限公司 销售",
      "岗位经验",
      "东莞市世川机械科技有限公司 客户代表",
      "机械/设备/重工 | 少于50人 | 民营",
      "东莞莞建强有限公司 客户代表",
      "广东大川机械有限公司 销售",
      "教育经历",
    ].join("\n");

    const parsed = parse51jobManualResume({ text });

    expect(parsed.workHistory).toEqual([
      expect.objectContaining({
        companyName: "东莞市世川机械科技有限公司",
        jobTitle: "客户代表",
        startDate: "2022-02",
        endDate: "至今",
      }),
      expect.objectContaining({
        companyName: "东莞莞建强有限公司",
        jobTitle: "客户代表",
        startDate: "2020-02",
        endDate: "2021-12",
      }),
      expect.objectContaining({
        companyName: "广东大川机械有限公司",
        jobTitle: "销售",
        startDate: "2017-02",
        endDate: "2020-09",
      }),
    ]);
  });

  it("dedupes project-based augmenting blocks when a richer work entry already exists", () => {
    const text = [
      "工作经历",
      "广东凌盛科技有限公司",
      "2017.01 - 2018.03（1年2个月）",
      "计算机服务(系统、数据服务、维修) ｜ 少于50人 ｜ 民营",
      "职位：销售代表",
      "工作描述：",
      "通过电话销售向客户介绍我司产品 提升客户排名 增加单品手淘流量",
      "项目经验",
      "手机淘宝推广",
      "2017.01 - 2018.03",
      "所属公司：",
      "广东凌盛科技有限公司",
      "项目描述：",
      "通过电话销售手淘流量 手淘排行",
    ].join("\n");

    const parsed = parse51jobManualResume({ text });

    expect(parsed.workHistory).toEqual([
      expect.objectContaining({
        companyName: "广东凌盛科技有限公司",
        jobTitle: "销售代表",
        description: expect.stringContaining("通过电话销售向客户介绍我司产品"),
        startDate: "2017-01",
        endDate: "2018-03",
      }),
    ]);
  });

  it("rebuilds timeline placeholders from longer 岗位经验 summaries", () => {
    const text = [
      "岗位经验",
      "CNC/数控编程-8年4个月 销售主管-3年3个月 销售专员-1年",
      "广州市昊志机电股份有限公司 编程操机",
      "500-1000人 | 已上市",
      "北京苏扬科技有限公司 销售主管",
      "北京联龙博通电子商务技术有限公司 销售专员",
      "深圳市聚精自动化设备有限公司 cnc数控编程",
      "日东科技控股有限公司 CNC/数控编程",
      "工作经历",
      "加工中心 2025.05-2025.07（2个月）",
      "2022.01-2025.04（3年3个月）",
      "2021.01-2022.01（1年）",
      "2017.04-2020.12（3年8个月）",
      "加工中心",
      "2012.09-2017.03（4年6个月）",
      "教育经历",
    ].join("\n");

    const parsed = parse51jobManualResume({ text });

    expect(parsed.workHistory).toEqual([
      expect.objectContaining({
        companyName: "广州市昊志机电股份有限公司",
        jobTitle: "编程操机",
        startDate: "2025-05",
        endDate: "2025-07",
      }),
      expect.objectContaining({
        companyName: "北京苏扬科技有限公司",
        jobTitle: "销售主管",
        startDate: "2022-01",
        endDate: "2025-04",
      }),
      expect.objectContaining({
        companyName: "北京联龙博通电子商务技术有限公司",
        jobTitle: "销售专员",
        startDate: "2021-01",
        endDate: "2022-01",
      }),
      expect.objectContaining({
        companyName: "深圳市聚精自动化设备有限公司",
        jobTitle: "cnc数控编程",
        startDate: "2017-04",
        endDate: "2020-12",
      }),
      expect.objectContaining({
        companyName: "日东科技控股有限公司",
        jobTitle: "CNC/数控编程",
        startDate: "2012-09",
        endDate: "2017-03",
      }),
    ]);
  });

  it("rebuilds timeline placeholders from 岗位经验 summaries with 系长 titles", () => {
    const text = [
      "岗位经验",
      "客户经理/主管-4年 销售经理-1年11个月 销售工程师-2年11个月 建筑工程管理/项目经理-7年 生产主管-2年",
      "米思米（中国）精密机械贸易有限公司 客户经理/主管",
      "深圳市创世纪机械有限公司 销售经理",
      "深圳硕方精密机械有限公司 销售工程师",
      "佛山市铭晖投资有限公司 工程主管",
      "佛山市华鹭自动控制器有限公司 系长",
      "工作经历",
      "2022.03-至今（4年）",
      "2020.02-2022.01（1年11个月）",
      "走心机",
      "2017.02-2020.01（2年11个月）",
      "走心机",
      "2009.08-2016.08（7年）",
      "2007.07-2009.07（2年）",
      "教育经历",
    ].join("\n");

    const parsed = parse51jobManualResume({ text });

    expect(parsed.workHistory).toEqual([
      expect.objectContaining({
        companyName: "米思米（中国）精密机械贸易有限公司",
        jobTitle: "客户经理/主管",
        startDate: "2022-03",
        endDate: "至今",
      }),
      expect.objectContaining({
        companyName: "深圳市创世纪机械有限公司",
        jobTitle: "销售经理",
        startDate: "2020-02",
        endDate: "2022-01",
      }),
      expect.objectContaining({
        companyName: "深圳硕方精密机械有限公司",
        jobTitle: "销售工程师",
        startDate: "2017-02",
        endDate: "2020-01",
      }),
      expect.objectContaining({
        companyName: "佛山市铭晖投资有限公司",
        jobTitle: "工程主管",
        startDate: "2009-08",
        endDate: "2016-08",
      }),
      expect.objectContaining({
        companyName: "佛山市华鹭自动控制器有限公司",
        jobTitle: "系长",
        startDate: "2007-07",
        endDate: "2009-07",
      }),
    ]);
  });

  it("keeps 岗位经验 detail text when timeline placeholders rebuild the same entry", () => {
    const text = [
      "/",
      "2025-11-03",
      "余先生 在职（一个月内到岗）",
      "28岁\t7年经验\t本科\t现居·东莞-大岭山镇",
      "岗位经验\t销售工程师-6年9个月",
      "佛山友博机电科技有限公司\t销售工程师",
      "机械/设备/重工 | 少于50人 | 创业公司",
      "一、工作内容",
      "该公司销售的主要产品是 CNC 数控机床，本人担任销售工程师的职位。",
      "主要工作内容为：",
      "1.寻找和联系潜在客户",
      "2.预约拜访潜在客户",
      "3. 挖掘客户需求和了解采购计划",
      "4.为客户产品选型提供方案",
      "5.合同的签订和设备的发货以及货款的回收跟进",
      "6.定期回访了解客户设备使用情况以及后期的采购计划",
      "二、工作职责",
      "1.寻找精准的目标客户：通过渠道搜素精准的目标客户，例如渠道有百度搜索、展会、展厅、抖音、地推等各个渠道。",
      "2.规划和跟进客户群：对收集来的客户进行区域和行业的精细划分。联系和拜访潜在客户，挖掘客户需求并跟进为客户提供方案。",
      "3.订单的签订和后期的客户维系：客户确定订单，跟进发货和货款的回收，定期回访客户，了解设备使用情况和后期的设备采购计划",
      "工作经历",
      "2019.06-至今（6年9个月）",
      "项目经验",
      "教育经历",
    ].join("\n");

    const parsed = parse51jobManualResume({ text });

    expect(parsed.workHistory).toEqual([
      expect.objectContaining({
        companyName: "佛山友博机电科技有限公司",
        jobTitle: "销售工程师",
        startDate: "2019-06",
        endDate: "至今",
        description: expect.stringContaining("该公司销售的主要产品是 CNC 数控机床"),
      }),
    ]);
    expect(parsed.workHistory[0]?.description).toContain("1.寻找和联系潜在客户");
    expect(parsed.workHistory[0]?.description).not.toContain("2019.06-至今");
  });

  it("rebuilds noisy multi-page work history from 岗位经验 and cross-page inline entries", () => {
    const text = [
      "/",
      "李先生 在职（到岗时间待定）",
      "35岁\t18年经验\t大专\t现居·东莞-南城区",
      "岗位经验\tCNC/数控编程-3年7个月\t生产主管-4年5个月\t生产经理/车间主任-1年8个月\t生产领班/组长-2年11个月",
      "CNC/数控操机-2年1个月\t客户代表-9个月\t仓库管理员-3个月\t理货员-5个月",
      "先进电子（珠海）有限公司\tCNC高级工程师",
      "主要负责数控车床与车铣复合和\t产品优化，程序优化，调机优化与产品工艺优化等。",
      "德玛电子有限公司\tCNC主管",
      "人才ID:974495233\t活跃时间:2026.03.16",
      "求职意向",
      "工作经历",
      "2024.07-2025.01（6个月）",
      "走心机",
      "2021.01-2024.06（3年5个月）",
      "广州宝力机械科技有限公司东莞分公司",
      "广州宝力机械科技有限公司东莞分公司",
      "聊",
      "天",
      "-- 1 of 3 --",
      "/",
      "沃克森模具有限公司\t机加车间主任",
      "东莞永耀传动科技有限公司\tCNC主管",
      "东莞培锋精密机械有限公司\tCNC/数控编程",
      "东莞卓蓝自动化有限公司\t组长",
      "宁波市鄞州佳祺电子制造有限公司\t数控车床",
      "东莞万田油墨有限公司\t客户代表",
      "2019.05-2021.01（1年8个月）",
      "2018.05-2019.05（1年）",
      "2015.03-2018.04（3年1个月）",
      "2012.03-2015.02（2年11个月）",
      "2010.01-2012.02（2年1个月）",
      "2009.04-2010.01（9个月）",
      "聊",
      "天",
      "-- 2 of 3 --",
      "/",
      "南良集团\t仓库管理员",
      "惠州响水河超市\t营业员",
      "广东南方职业学院",
      "大专 · 机电一体化技术",
      "2024.03-2026.07",
      "湛江艺术学校",
      "中技/中专 · 声乐",
      "2006.08-2008.05",
      "2008.12-2009.03（3个月）",
      "2008.07-2008.12（5个月）",
      "教育经历",
    ].join("\n");

    const parsed = parse51jobManualResume({ text });

    expect(parsed.workHistory).toEqual([
      expect.objectContaining({
        companyName: "先进电子（珠海）有限公司",
        jobTitle: "CNC高级工程师",
        startDate: "2024-07",
        endDate: "2025-01",
      }),
      expect.objectContaining({
        companyName: "德玛电子有限公司",
        jobTitle: "CNC主管",
        startDate: "2021-01",
        endDate: "2024-06",
      }),
      expect.objectContaining({
        companyName: "沃克森模具有限公司",
        jobTitle: "机加车间主任",
        startDate: "2019-05",
        endDate: "2021-01",
      }),
      expect.objectContaining({
        companyName: "东莞永耀传动科技有限公司",
        jobTitle: "CNC主管",
        startDate: "2018-05",
        endDate: "2019-05",
      }),
      expect.objectContaining({
        companyName: "东莞培锋精密机械有限公司",
        jobTitle: "CNC/数控编程",
        startDate: "2015-03",
        endDate: "2018-04",
      }),
      expect.objectContaining({
        companyName: "东莞卓蓝自动化有限公司",
        jobTitle: "组长",
        startDate: "2012-03",
        endDate: "2015-02",
      }),
      expect.objectContaining({
        companyName: "宁波市鄞州佳祺电子制造有限公司",
        jobTitle: "数控车床",
        startDate: "2010-01",
        endDate: "2012-02",
      }),
      expect.objectContaining({
        companyName: "东莞万田油墨有限公司",
        jobTitle: "客户代表",
        startDate: "2009-04",
        endDate: "2010-01",
      }),
      expect.objectContaining({
        companyName: "南良集团",
        jobTitle: "仓库管理员",
        startDate: "2008-12",
        endDate: "2009-03",
      }),
      expect.objectContaining({
        companyName: "惠州响水河超市",
        jobTitle: "营业员",
        startDate: "2008-07",
        endDate: "2008-12",
      }),
    ]);
    expect(parsed.workHistory).toHaveLength(10);
    expect(parsed.workHistory.some((entry) => entry.companyName === "广州宝力机械科技有限公司东莞分公司")).toBe(false);
    expect(parsed.workHistory.some((entry) => entry.jobTitle === "走心机")).toBe(false);
    expect(parsed.workHistory.some((entry) => entry.companyName === "广东南方职业学院")).toBe(false);
  });
});
