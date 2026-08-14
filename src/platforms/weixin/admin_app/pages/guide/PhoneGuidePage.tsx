import { AlertTriangle, CheckCircle2, MonitorSmartphone, Terminal } from 'lucide-react';
import { Panel } from '../../components/ui/Panel';

const projectCommands = [
  ['/project', '查看当前项目目录、默认目录和权限状态'],
  ['/project on', '使用当前会话或默认目录开启项目控制'],
  ['/project cancel', '取消还没有开始的项目控制会话'],
] as const;

const approvalCommands = [
  ['/allow', '查看当前等待审批的请求'],
  ['/allow 1', '单次批准第 1 个请求'],
  ['/allow 2', '批准并在当前会话记住类似请求'],
  ['/deny', '拒绝当前审批请求'],
] as const;

const permissionCommands = [
  ['/permissions', '查看当前权限模式'],
  ['/permissions default-permissions', '工作区内可写，高风险操作会询问，推荐日常使用'],
  ['/permissions auto-review', '由审查代理辅助处理符合条件的审批'],
  ['/permissions full-access', '完全访问且不审批，仅用于明确可信的任务'],
] as const;

const uploadCommands = [
  ['/up', '开启上传暂存模式'],
  ['/up status', '查看已经暂存的图片和文件'],
  ['/up cancel', '取消上传并清空本次暂存'],
] as const;

const sessionCommands = [
  ['/new', '准备新会话；下一条普通消息才真正创建'],
  ['/threads', '查看历史会话列表'],
  ['/next /prev', '切换历史会话列表的下一页或上一页'],
  ['/search 项目学习', '按标题或内容搜索历史会话'],
  ['/open 2', '打开当前列表第 2 个会话'],
  ['/open 项目学习', '按名字打开会话'],
  ['/peek 2', '预览第 2 个会话最近内容，但不切换'],
  ['/rename this 项目学习', '给当前会话改名'],
  ['/rename 2 项目学习', '给列表第 2 个会话改名'],
  ['/threads del 2', '归档列表第 2 个会话'],
  ['/threads pin 2', '置顶列表第 2 个会话'],
  ['/threads all', '查看全部会话，包括归档项'],
] as const;

const modelCommands = [
  ['/provider', '查看或切换 Provider Profile'],
  ['/models', '查看当前 Provider 可用模型'],
  ['/model', '查看当前模型、模型来源和推理强度'],
  ['/model gpt-5.6-sol', '切换到指定模型'],
  ['/model high', '只切换推理强度'],
  ['/model gpt-5.6-sol ultra', '同时切换模型和推理强度'],
  ['/model default', '恢复 Provider 默认模型和推理配置'],
] as const;

const commonCommands = [
  ['/helps', '查看全部命令帮助，也可用 /helps project 查看单个命令'],
  ['/status', '查看当前会话、项目目录、模型、权限和运行状态'],
  ['/usage', '查看当前账号用量和额度摘要'],
  ['/stop', '停止当前正在回复或执行的任务'],
  ['/retry', '重试上一条任务'],
  ['/reconnect', '刷新当前 Provider / Codex 连接'],
  ['/restart', '请求重启桥接服务'],
  ['/compact', '手动压缩当前 Codex 上下文'],
  ['/review', '对当前项目改动执行代码审查'],
  ['/skills', '查看当前项目可用 Skills'],
  ['/plugins', '查看和管理插件'],
  ['/apps', '查看 Apps / Connectors'],
  ['/mcp', '查看 MCP Servers'],
  ['/use @插件名 任务', '指定本轮优先使用某个插件'],
  ['/instructions', '查看或修改全局自定义指令'],
  ['/personality', '查看或切换会话风格'],
  ['/plan on / /plan off', '开启或关闭规划模式'],
  ['/fast / /fast off', '开启或关闭 Fast 模式'],
  ['/lang zh-CN / /lang en', '切换桥接回复语言'],
  ['/as', '助理记录统一入口，自动识别日志、待办、提醒和笔记'],
  ['/log / /todo / /remind / /note', '分别保存日志、待办、提醒和笔记'],
  ['/login', '管理 Codex 登录账号或刷新登录状态'],
] as const;

type CommandRowsProps = {
  commands: ReadonlyArray<readonly [string, string]>;
};

function CommandRows({ commands }: CommandRowsProps) {
  return (
    <div className="command-list">
      {commands.map(([command, description]) => (
        <div key={command}><code>{command}</code><span>{description}</span></div>
      ))}
    </div>
  );
}

export function PhoneGuidePage() {
  return (
    <div className="page-stack phone-guide-page">
      <section className="guide-intro">
        <span className="guide-intro__icon"><MonitorSmartphone /></span>
        <div>
          <h2>手机微信使用 Codex</h2>
          <p>微信消息由本机 CodexBridge 转发给电脑上的 Codex。电脑必须保持开机、联网，并持续运行本软件。</p>
        </div>
      </section>

      <div className="guide-flow" aria-label="首次使用流程">
        {['配置模型', '添加微信账号', '发送测试消息', '指定项目目录'].map((label, index) => (
          <div key={label}><span>{index + 1}</span><strong>{label}</strong></div>
        ))}
      </div>

      <Panel title="完整使用流程" subtitle="第一次使用建议先验证普通聊天，再开启项目控制">
        <ol className="guide-steps">
          <li><CheckCircle2 /><span>打开 CodexBridge Weixin Admin，等待顶部状态显示服务正常。</span></li>
          <li><CheckCircle2 /><span>进入“模型供应商”，选择手动配置或跟随 CCSwitch，并确认模型连接可用。</span></li>
          <li><CheckCircle2 /><span>进入“用户入口”生成二维码，用微信扫码完成账号接入。</span></li>
          <li><CheckCircle2 /><span>在微信发送“你好”，再发送 <code>/status</code> 检查会话、模型和权限。</span></li>
          <li><CheckCircle2 /><span>需要控制项目时发送 <code>/project D:\你的项目路径</code>，然后说明目标、范围和验证方式。</span></li>
        </ol>
      </Panel>

      <Panel title="使用边界">
        <div className="guide-topic-grid">
          <section className="guide-topic">
            <h3>手机能做什么</h3>
            <ul>
              <li>像普通聊天一样向 Codex 提问，并把最终答案发回微信。</li>
              <li>让 Codex 在电脑项目目录中读代码、改文件、运行测试并总结结果。</li>
              <li>连续发送多张截图或多个文件，最后用一句提示词统一分析。</li>
              <li>新建、搜索、切换、重命名、归档和置顶历史会话。</li>
              <li>在需要运行命令或修改文件时，通过微信完成审批。</li>
            </ul>
          </section>
          <section className="guide-topic">
            <h3>手机不能脱离电脑</h3>
            <ul>
              <li>电脑关机、睡眠、断网或软件退出后，微信端不能继续调用本地 Codex。</li>
              <li>朋友扫码后使用的仍是这台电脑上的服务、API Key 和数据目录。</li>
              <li>API Key 无额度、Provider 不可用或模型接口异常时，微信端也会失败。</li>
              <li>二维码过期后必须重新生成，旧二维码不能继续使用。</li>
            </ul>
          </section>
        </div>
      </Panel>

      <Panel title="CCSwitch 和 API Key" subtitle="两种配置来源二选一即可">
        <div className="guide-topic-grid">
          <section className="guide-topic">
            <h3>手动配置</h3>
            <p>直接在“模型供应商”填写 API Key、Base URL 并从模型列表选择模型。API Key 留空保存时会保留已保存的密钥。</p>
          </section>
          <section className="guide-topic">
            <h3>跟随 CCSwitch</h3>
            <p>在 CCSwitch 切换 Key 或模型后，后台会按配置间隔自动同步；也可以在管理后台手动触发同步。</p>
          </section>
        </div>
      </Panel>

      <Panel title="手机控制项目：推荐写法" subtitle="任务最好包含目标、范围、验证方式和输出要求">
        <div className="guide-code-stack">
          <code>/project D:\你的项目路径</code>
          <code>请检查为什么管理面板打不开。先定位原因，再修复；只改必要文件；修复后运行相关测试；最后告诉我根因、修改文件和测试结果。</code>
        </div>
        <CommandRows commands={projectCommands} />
      </Panel>

      <Panel title="审批和权限" subtitle="日常使用建议保持默认权限模式">
        <div className="guide-command-columns">
          <section>
            <h3>审批请求</h3>
            <CommandRows commands={approvalCommands} />
          </section>
          <section>
            <h3>权限模式怎么选</h3>
            <CommandRows commands={permissionCommands} />
          </section>
        </div>
      </Panel>

      <Panel title="图片和文件：多张一起发" subtitle="先暂存文件，发送文字说明后再统一处理">
        <div className="guide-code-stack">
          <code>/up</code>
          <code>连续发送图片或文件</code>
          <code>请结合刚才所有截图，判断为什么服务启动失败，并给我按步骤排查。</code>
        </div>
        <CommandRows commands={uploadCommands} />
      </Panel>

      <Panel title="会话管理：让历史对话好找">
        <CommandRows commands={sessionCommands} />
      </Panel>

      <Panel title="模型和供应商" subtitle="不同 Provider 和模型支持的推理强度可能不同">
        <CommandRows commands={modelCommands} />
      </Panel>

      <Panel title="所有常用命令速查" subtitle="实际可用命令以微信中的 /helps 返回为准">
        <CommandRows commands={commonCommands} />
      </Panel>

      <Panel title="故障排查">
        <div className="guide-troubleshooting">
          <div><Terminal /><span><strong>一直显示正在输入</strong><small>先发送 /status，再用 /stop 中断；必要时用 /reconnect 或在管理后台重启桥接。</small></span></div>
          <div><AlertTriangle /><span><strong>提示有一轮回复正在进行</strong><small>等待当前任务完成，或先发送 /stop 再提交新任务。</small></span></div>
          <div><AlertTriangle /><span><strong>出现 502 / 503</strong><small>通常是上游模型服务暂时不可用，稍后使用 /retry，并检查 Provider、API Key 和 Base URL。</small></span></div>
          <div><AlertTriangle /><span><strong>出现 429</strong><small>通常是额度不足、请求过快或 Provider 限速，需要更换 Key、降低并发或等待额度恢复。</small></span></div>
          <div><AlertTriangle /><span><strong>朋友扫码无法连接</strong><small>检查电脑是否开机联网、桥接是否运行、微信账号是否在线，以及二维码是否过期。</small></span></div>
          <div><AlertTriangle /><span><strong>更换 Key 后仍然报错</strong><small>手动模式需要保存新 Key；CCSwitch 模式切换后需等待同步或执行 /reconnect。</small></span></div>
        </div>
      </Panel>

      <Panel title="推荐任务模板">
        <div className="guide-template-list">
          <p>请在当前项目里定位并修复这个问题。要求：先读相关代码；只改必要文件；修改后运行相关测试；最后告诉我根因、修改文件和测试结果。</p>
          <p>请给当前项目新增功能。要求：保持现有 UI 风格；功能完整可用；添加必要测试；最后告诉我怎么使用。</p>
          <p>请结合我刚才发送的截图分析问题。先判断最可能原因，再给我按步骤排查；如果需要更多信息，请明确指出需要哪一段日志或哪张截图。</p>
        </div>
      </Panel>
    </div>
  );
}
