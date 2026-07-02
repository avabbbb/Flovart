using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace FlovartLauncher
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new LauncherForm());
        }
    }

    internal sealed class LauncherForm : Form
    {
        private readonly string rootDir;
        private readonly TextBox logBox;
        private readonly Label statusLabel;
        private Process activeProcess;

        public LauncherForm()
        {
            rootDir = FindProjectRoot();
            Text = "Flovart 启动器";
            StartPosition = FormStartPosition.CenterScreen;
            MinimumSize = new Size(860, 560);
            Size = new Size(980, 680);
            Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Regular, GraphicsUnit.Point);

            var main = new TableLayoutPanel();
            main.Dock = DockStyle.Fill;
            main.RowCount = 3;
            main.ColumnCount = 1;
            main.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            main.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            main.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            main.Padding = new Padding(12);
            Controls.Add(main);

            var toolbar = new FlowLayoutPanel();
            toolbar.Dock = DockStyle.Fill;
            toolbar.AutoSize = true;
            toolbar.WrapContents = true;
            toolbar.Padding = new Padding(0, 0, 0, 8);
            main.Controls.Add(toolbar, 0, 0);

            AddButton(toolbar, "安装依赖", delegate { RunStartup("install"); });
            AddButton(toolbar, "启动全部并打开浏览器", delegate { RunStartup("all"); });
            AddButton(toolbar, "只启前端", delegate { RunStartup("web"); });
            AddButton(toolbar, "后端 + 数据库", delegate { RunStartup("backend"); });
            AddButton(toolbar, "Docker 全量启动", delegate { RunStartup("docker"); });
            AddButton(toolbar, "Docker 后台启动", delegate { RunStartup("docker-detach"); });
            AddButton(toolbar, "自检", delegate { RunStartup("doctor"); });
            AddButton(toolbar, "打开浏览器", delegate { OpenBrowser(); });
            AddButton(toolbar, "停止当前命令", delegate { StopActiveProcess(); });

            logBox = new TextBox();
            logBox.Dock = DockStyle.Fill;
            logBox.Multiline = true;
            logBox.ReadOnly = true;
            logBox.ScrollBars = ScrollBars.Both;
            logBox.WordWrap = false;
            logBox.BackColor = Color.FromArgb(18, 18, 18);
            logBox.ForeColor = Color.FromArgb(230, 230, 230);
            logBox.Font = new Font("Consolas", 10F, FontStyle.Regular, GraphicsUnit.Point);
            main.Controls.Add(logBox, 0, 1);

            statusLabel = new Label();
            statusLabel.Dock = DockStyle.Fill;
            statusLabel.AutoSize = true;
            statusLabel.Padding = new Padding(0, 8, 0, 0);
            statusLabel.Text = "项目目录：" + rootDir + "    Web：http://localhost:11451";
            main.Controls.Add(statusLabel, 0, 2);

            AppendLog("Flovart 启动器已就绪。所有按钮都会调用根目录的 启动.bat，日志保留在这里方便调试和截图。\r\n");
        }

        private void AddButton(FlowLayoutPanel panel, string text, EventHandler handler)
        {
            var button = new Button();
            button.Text = text;
            button.AutoSize = true;
            button.Height = 34;
            button.Margin = new Padding(0, 0, 8, 8);
            button.Padding = new Padding(8, 3, 8, 3);
            button.Click += handler;
            panel.Controls.Add(button);
        }

        private static string FindProjectRoot()
        {
            var dir = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);
            while (dir != null)
            {
                if (File.Exists(Path.Combine(dir.FullName, "tools", "flovart", "cli.js"))) return dir.FullName;
                dir = dir.Parent;
            }
            return Environment.CurrentDirectory;
        }

        private void RunStartup(string action)
        {
            var bat = Path.Combine(rootDir, "启动.bat");
            if (!File.Exists(bat))
            {
                AppendLog("未找到启动.bat：" + bat + "\r\n");
                return;
            }
            if (activeProcess != null && !activeProcess.HasExited)
            {
                AppendLog("已有命令正在运行，请先停止当前命令。\r\n");
                return;
            }

            AppendLog("> 启动.bat " + action + "\r\n");
            statusLabel.Text = "运行中：" + action;

            var psi = new ProcessStartInfo();
            psi.FileName = "cmd.exe";
            psi.Arguments = "/c \"\"" + bat + "\" " + action + "\"";
            psi.WorkingDirectory = rootDir;
            psi.UseShellExecute = false;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.CreateNoWindow = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;

            activeProcess = new Process();
            activeProcess.StartInfo = psi;
            activeProcess.EnableRaisingEvents = true;
            activeProcess.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) AppendLog(e.Data + "\r\n"); };
            activeProcess.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) AppendLog(e.Data + "\r\n"); };
            activeProcess.Exited += delegate
            {
                var code = activeProcess.ExitCode;
                BeginInvoke((Action)(delegate
                {
                    statusLabel.Text = "命令已结束，退出码：" + code;
                    AppendLog("\r\n[Flovart] 命令结束，退出码：" + code + "\r\n");
                }));
            };

            try
            {
                activeProcess.Start();
                activeProcess.BeginOutputReadLine();
                activeProcess.BeginErrorReadLine();
                if (action == "all" || action == "web" || action == "docker" || action == "docker-detach") OpenBrowserDelayed();
            }
            catch (Exception ex)
            {
                AppendLog("启动失败：" + ex.Message + "\r\n");
                statusLabel.Text = "启动失败";
            }
        }

        private void StopActiveProcess()
        {
            if (activeProcess == null || activeProcess.HasExited)
            {
                AppendLog("没有正在运行的命令。\r\n");
                return;
            }
            try
            {
                Process.Start(new ProcessStartInfo("taskkill", "/PID " + activeProcess.Id + " /T /F") { CreateNoWindow = true, UseShellExecute = false });
                AppendLog("已请求停止当前命令。\r\n");
            }
            catch (Exception ex)
            {
                AppendLog("停止失败：" + ex.Message + "\r\n");
            }
        }

        private void OpenBrowserDelayed()
        {
            Task.Run(delegate
            {
                System.Threading.Thread.Sleep(1800);
                BeginInvoke((Action)(delegate { OpenBrowser(); }));
            });
        }

        private void OpenBrowser()
        {
            try
            {
                Process.Start(new ProcessStartInfo("http://localhost:11451") { UseShellExecute = true });
                AppendLog("已打开浏览器：http://localhost:11451\r\n");
            }
            catch (Exception ex)
            {
                AppendLog("打开浏览器失败：" + ex.Message + "\r\n");
            }
        }

        private void AppendLog(string text)
        {
            if (InvokeRequired)
            {
                BeginInvoke((Action)(delegate { AppendLog(text); }));
                return;
            }
            logBox.AppendText(text);
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            StopActiveProcess();
            base.OnFormClosing(e);
        }
    }
}