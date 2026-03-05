# SQL DDL 生成器 - 使用手册

## 📖 项目简介

SQL DDL 生成器是一款高效的数据库建表语句生成工具，支持从 Excel 文件或 SQL 查询语句自动生成 Spark、MySQL、StarRocks 三种数据库的建表 DDL 语句，大幅提升数据开发效率。

---

## 🚀 核心功能

### 1️⃣ Excel 上传生成 DDL

**功能说明**：上传 Excel 文件，自动解析字段信息并生成建表语句。

**支持生成**：
- **ODS 建表语句**：数据接入层表结构，`etl_time` 字段类型为 `STRING`
- **DWD 建表语句**：数据明细层表结构，`etl_time` 字段类型为 `TIMESTAMP`
- **INSERT 语句**：数据插入语句

**操作步骤**：
1. 点击「Excel上传」标签页
2. 上传 Excel 文件（支持 .xlsx, .xls 格式）
3. 系统自动解析字段名、字段类型、字段注释
4. 选择需要生成的数据库类型（Spark / MySQL / StarRocks）
5. 点击生成按钮，一键复制结果

---

### 2️⃣ DDL 生成器

**功能说明**：输入 SQL 查询语句，自动解析字段并生成建表 DDL。

**输入示例**：
```sql
SELECT
    uuid()                       AS id
    ,m.iowh_rtrc_ingicodex       AS iowh_rtrc_ingicodex  -- 进出仓回单核销子项ID
    ,m.mana_org                  AS mana_org             -- 经营单位
    ,m.gicode                    AS gicode               -- 商品内码
    ,m.qty                       AS invr_qty             -- 库存数量
    ,m.invr_rcy1                 AS invr_rcy1            -- 库存RMB金额
    ,m.busi_date                 AS busi_date            -- 业务日期
    ,current_timestamp()         AS etl_time             -- 数据生成时间
FROM gf_core.dwd_logt_stock_gt_invr_blnc_dtal_di m
```

**生成结果示例**：

#### Spark SQL
```sql
CREATE TABLE IF NOT EXISTS 表名 (
    id                             STRING             COMMENT ''
   ,iowh_rtrc_ingicodex            STRING             COMMENT '进出仓回单核销子项ID'
   ,mana_org                       STRING             COMMENT '经营单位'
   ,gicode                         STRING             COMMENT '商品内码'
   ,invr_qty                       DECIMAL(24,6)      COMMENT '库存数量'
   ,invr_rcy1                      DECIMAL(24,6)      COMMENT '库存RMB金额'
   ,busi_date                      DATE               COMMENT '业务日期'
   ,etl_time                       TIMESTAMP          COMMENT '数据生成时间'
)
COMMENT ''
PARTITIONED BY (pt STRING COMMENT '日分区')
STORED AS ORC
LIFECYCLE 10;
```

#### MySQL
```sql
CREATE TABLE 表名 (
    id                             VARCHAR(256)       COMMENT ''
   ,iowh_rtrc_ingicodex            VARCHAR(256)       COMMENT '进出仓回单核销子项ID'
   ,mana_org                       VARCHAR(256)       COMMENT '经营单位'
   ,gicode                         VARCHAR(256)       COMMENT '商品内码'
   ,invr_qty                       DECIMAL(24,6)      COMMENT '库存数量'
   ,invr_rcy1                      DECIMAL(24,6)      COMMENT '库存RMB金额'
   ,busi_date                      DATE               COMMENT '业务日期'
   ,etl_time                       DATETIME           COMMENT '数据生成时间'
   ,PRIMARY KEY (id)
)
ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='';
```

#### StarRocks
```sql
CREATE TABLE 表名 (
    id                             VARCHAR(256)       COMMENT ''
   ,iowh_rtrc_ingicodex            VARCHAR(256)       COMMENT '进出仓回单核销子项ID'
   ,mana_org                       VARCHAR(256)       COMMENT '经营单位'
   ,gicode                         VARCHAR(256)       COMMENT '商品内码'
   ,invr_qty                       DECIMAL(24,6)      COMMENT '库存数量'
   ,invr_rcy1                      DECIMAL(24,6)      COMMENT '库存RMB金额'
   ,busi_date                      DATE               COMMENT '业务日期'
   ,etl_time                       DATETIME           COMMENT '数据生成时间'
)
ENGINE=OLAP
PRIMARY KEY (id)
COMMENT ''
DISTRIBUTED BY HASH(id) BUCKETS 10
PROPERTIES (
    "replication_num" = "3",
    "in_memory" = "false",
    "enable_persistent_index" = "true",
    "replicated_storage" = "true",
    "compression" = "LZ4"
);
```

---

### 3️⃣ ALTER 生成器

**功能说明**：输入字段列表，快速生成 ALTER TABLE 添加字段的语句。

**输入格式支持**：
```
-- 格式1：字段名 + 注释
col_salordicodex     comment '销售合同内码'
,col_salordcodex     comment '销售合同号'

-- 格式2：带表别名
m.acnt_org           -- 核算组
,m.acnt_org_name     -- 核算组名称

-- 格式3：带类型定义
acnt_org STRING COMMENT '核算组'
```

**生成结果示例**：

#### Spark SQL
```sql
alter table 表名 add columns(
    col_salordicodex              STRING              COMMENT '销售合同内码'
    ,col_salordcodex              STRING              COMMENT '销售合同号'
);
```

#### MySQL
```sql
ALTER TABLE 表名
ADD COLUMN col_salordicodex VARCHAR(256)		COMMENT '销售合同内码'
,ADD COLUMN col_salordcodex VARCHAR(256)		COMMENT '销售合同号';
```

#### StarRocks
```sql
ALTER TABLE 表名
ADD COLUMN col_salordicodex VARCHAR(256) comment '销售合同内码'
,ADD COLUMN col_salordcodex VARCHAR(256) comment '销售合同号';
```

---

### 4️⃣ 规则管理器

**功能说明**：自定义字段类型推断规则，实现智能类型映射。

**规则配置项**：
| 配置项 | 说明 |
|--------|------|
| 关键词 | 匹配字段名或注释的关键词，支持多个 |
| 匹配方式 | `包含`、`等于`、`前缀匹配`、`后缀匹配` |
| 匹配目标 | `字段名` 或 `注释` |
| 目标数据库 | Spark / MySQL / StarRocks |
| 数据类型 | 各数据库对应的类型 |
| 类型参数 | 精度、标度、长度等 |
| 优先级 | 规则匹配顺序，数字越小优先级越高 |

**内置规则示例**：
| 关键词 | 匹配方式 | 目标 | Spark 类型 | MySQL 类型 | StarRocks 类型 |
|--------|----------|------|------------|------------|----------------|
| amt, amount, price, 金额, 价格 | 包含 | 字段名 | DECIMAL(24,6) | DECIMAL(24,6) | DECIMAL(24,6) |
| date, 日期 | 包含 | 字段名 | DATE | DATE | DATE |
| time, timestamp, 时间 | 包含 | 字段名 | TIMESTAMP | DATETIME | DATETIME |
| id, icode | 包含 | 字段名 | STRING | VARCHAR(256) | VARCHAR(256) |
| name, 名称, 描述, 备注 | 包含 | 字段名 | STRING | VARCHAR(256) | VARCHAR(256) |

**规则持久化**：所有自定义规则自动保存到浏览器本地存储，刷新页面后保留。

---

### 5️⃣ 码转名配置

**功能说明**：配置码值转名称的维表映射关系，用于数据开发中的码值转换。

**配置内容**：
- 维表名称
- 码值字段
- 名称字段
- 关联条件

---

## 📊 类型推断逻辑

### 默认类型

| 数据库 | 默认类型 |
|--------|----------|
| Spark | STRING |
| MySQL | VARCHAR(256) |
| StarRocks | VARCHAR(256) |

### DECIMAL 类型处理

当规则匹配到 DECIMAL 类型时：
- **有配置参数**：使用配置的 precision 和 scale
- **无配置参数**：默认使用 `DECIMAL(24, 6)`

---

## 🔧 特殊处理

### 主键选择
- **优先使用第一个字段**作为主键（MySQL、StarRocks）

### StarRocks 建表特性
- 不使用 `IF NOT EXISTS`
- 自动添加 PRIMARY KEY
- 自动添加 DISTRIBUTED BY HASH
- 自动添加 PROPERTIES 配置

### Spark 建表特性
- 使用 `IF NOT EXISTS`
- 自动添加分区字段 `pt STRING`
- 自动设置存储格式为 ORC
- 自动设置生命周期为 10 天

---

## 📋 使用场景

| 场景 | 推荐功能 |
|------|----------|
| 数据仓库建表 | DDL 生成器 |
| 表结构变更（加字段） | ALTER 生成器 |
| 批量字段类型统一 | 规则管理器 |
| 数据模型文档转建表语句 | Excel 上传 |
| 码值转换开发 | 码转名配置 |

---

## 💡 最佳实践

1. **先配置规则**：在使用前，先在规则管理器中配置好常用的字段类型规则
2. **规范命名**：字段命名遵循统一的命名规范，便于规则匹配
3. **注释完整**：为每个字段添加清晰的注释，便于后续维护
4. **选择合适的主键**：第一个字段会自动设为主键，请确保字段顺序正确

---

## 🛠️ 技术栈

- **前端框架**：Next.js 16 + React 19 + TypeScript 5
- **UI 组件**：shadcn/ui + Tailwind CSS 4
- **Excel 解析**：xlsx
- **图标**：lucide-react

---

## 📞 支持与反馈

如有问题或建议，请联系开发团队。

---

**版本**：v1.0.0  
**更新日期**：2025年1月
