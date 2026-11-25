// Pitchlens.exe - the desktop window of Pitchlens (no console, no browser).
//
// It starts the Python server hidden ("pythonw Pitchlens.pyw --server --port N"), shows the UI in its own
// window with Microsoft WebView2 (the web engine that ships with Windows 10/11) and stops the server
// when the window closes. On the first run it creates Desktop / Start Menu shortcuts.
// Build: launcher\build.bat (C# compiler that ships with .NET Framework 4; C# 5 syntax only).
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

static class Launcher
{
    public static readonly string Dir = AppDomain.CurrentDomain.BaseDirectory;
    public static readonly string RuntimeDir = Path.Combine(Dir, "runtime");
    public static readonly string DataDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Pitchlens");
    const int DefaultPort = 8770;

    [STAThread]
    static int Main()
    {
        // WebView2 assemblies live in .\runtime (keeps the app folder tidy)
        AppDomain.CurrentDomain.AssemblyResolve += delegate (object s, ResolveEventArgs e)
        {
            string p = Path.Combine(RuntimeDir, new AssemblyName(e.Name).Name + ".dll");
            return File.Exists(p) ? Assembly.LoadFrom(p) : null;
        };
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Directory.CreateDirectory(DataDir);

        string script = Path.Combine(Dir, "Pitchlens.pyw");
        if (!File.Exists(script))
        {
            MessageBox.Show("Pitchlens.pyw was not found next to Pitchlens.exe.\nPlease extract the whole folder.",
                "Pitchlens", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return 1;
        }

        int port = DefaultPort;
        bool ownServer = false;
        if (!Ping(port))
        {
            string python = FindPythonW();
            if (python == null)
            {
                var answer = MessageBox.Show(
                    "Pitchlens needs Python 3.10 or newer (free).\n\nOpen python.org to download it?\n\n" +
                    "Pitchlens precisa do Python 3.10 ou mais novo (gratuito).\nAbrir o python.org para baixar?",
                    "Pitchlens", MessageBoxButtons.YesNo, MessageBoxIcon.Information);
                if (answer == DialogResult.Yes) Process.Start("https://www.python.org/downloads/");
                return 2;
            }
            port = FreePort(DefaultPort);
            var psi = new ProcessStartInfo(python, "\"" + script + "\" --server --port " + port)
            {
                WorkingDirectory = Dir, UseShellExecute = false, CreateNoWindow = true,
            };
            try { Process.Start(psi); ownServer = true; }
            catch (Exception e)
            {
                MessageBox.Show("Could not start Python:\n" + e.Message, "Pitchlens", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 3;
            }
        }
        CreateShortcutsOnce();
        return RunWindow(port, ownServer);
    }

    [MethodImpl(MethodImplOptions.NoInlining)]   // WebView2 types are resolved only after AssemblyResolve is set
    static int RunWindow(int port, bool ownServer)
    {
        Application.Run(new MainWindow(port, ownServer));
        return 0;
    }

    public static bool Ping(int port)
    {
        try
        {
            var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/api/ping");
            req.Timeout = 800;
            req.Proxy = null;
            using (var resp = req.GetResponse())
            using (var rd = new StreamReader(resp.GetResponseStream()))
                return rd.ReadToEnd().Contains("\"pitchlens\"");
        }
        catch (Exception) { return false; }
    }

    public static void Quit(int port)
    {
        try
        {
            var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/api/quit");
            req.Timeout = 1500;
            req.Proxy = null;
            req.GetResponse().Close();
        }
        catch (Exception) { }
    }

    static int FreePort(int start)
    {
        for (int p = start; p < start + 50; p++)
        {
            try
            {
                var l = new TcpListener(IPAddress.Loopback, p);
                l.Start(); l.Stop();
                return p;
            }
            catch (SocketException) { }
        }
        return start;
    }

    // pythonw.exe / pyw.exe on PATH (includes the Microsoft Store / Python install manager aliases),
    // then the usual per-user and machine-wide install folders.
    static string FindPythonW()
    {
        var path = (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';');
        foreach (string name in new[] { "pythonw.exe", "pyw.exe" })
            foreach (string p in path)
            {
                try
                {
                    string f = Path.Combine(p.Trim(), name);
                    if (p.Trim().Length > 0 && File.Exists(f)) return f;
                }
                catch (ArgumentException) { }
            }

        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string progs = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        foreach (string root in new[] { Path.Combine(local, "Programs", "Python"), Path.Combine(local, "Python"), progs })
        {
            if (!Directory.Exists(root)) continue;
            var found = Directory.GetDirectories(root)
                .Where(d => Path.GetFileName(d).StartsWith("Python", StringComparison.OrdinalIgnoreCase)
                         || Path.GetFileName(d).StartsWith("pythoncore", StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(d => d)
                .Select(d => Path.Combine(d, "pythonw.exe"))
                .FirstOrDefault(File.Exists);
            if (found != null) return found;
        }
        return null;
    }

    // First run only: "Pitchlens" shortcuts with the app icon on the Desktop and in the Start Menu.
    static void CreateShortcutsOnce()
    {
        try
        {
            string marker = Path.Combine(DataDir, "shortcuts.done");
            if (File.Exists(marker)) return;
            string exe = Path.Combine(Dir, "Pitchlens.exe");
            string icon = Path.Combine(Dir, "web", "pitchlens.ico");
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            object shell = Activator.CreateInstance(shellType);
            foreach (var folder in new[] { Environment.SpecialFolder.DesktopDirectory, Environment.SpecialFolder.Programs })
            {
                string link = Path.Combine(Environment.GetFolderPath(folder), "Pitchlens.lnk");
                object lnk = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { link });
                Type t = lnk.GetType();
                t.InvokeMember("TargetPath", BindingFlags.SetProperty, null, lnk, new object[] { exe });
                t.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, lnk, new object[] { Dir });
                t.InvokeMember("IconLocation", BindingFlags.SetProperty, null, lnk, new object[] { icon + ",0" });
                t.InvokeMember("Description", BindingFlags.SetProperty, null, lnk, new object[] { "Pitchlens - every player, in focus" });
                t.InvokeMember("Save", BindingFlags.InvokeMethod, null, lnk, null);
            }
            File.WriteAllText(marker, "ok");
        }
        catch (Exception) { /* shortcuts are a convenience only */ }
    }
}

class MainWindow : Form
{
    readonly int port;
    readonly bool ownServer;
    readonly Label splash;
    WebView2 web;

    public MainWindow(int port, bool ownServer)
    {
        this.port = port;
        this.ownServer = ownServer;
        Text = "Pitchlens";
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception) { }
        BackColor = Color.FromArgb(12, 12, 13);
        var area = Screen.PrimaryScreen.WorkingArea;
        Size = new Size(Math.Min(1440, (int)(area.Width * 0.9)), Math.Min(900, (int)(area.Height * 0.9)));
        MinimumSize = new Size(900, 600);
        StartPosition = FormStartPosition.CenterScreen;
        splash = new Label
        {
            Text = "Pitchlens", Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleCenter,
            ForeColor = Color.FromArgb(240, 237, 230), Font = new Font("Segoe UI", 22f, FontStyle.Regular),
        };
        Controls.Add(splash);
        Shown += async delegate { await Start(); };
        FormClosed += delegate { if (ownServer) Launcher.Quit(port); };
    }

    async Task Start()
    {
        string url = "http://127.0.0.1:" + port + "/";
        bool ok = true;
        try
        {
            CoreWebView2Environment.SetLoaderDllFolderPath(Launcher.RuntimeDir);
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Launcher.DataDir, "webview"), null);
            web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = BackColor };
            await web.EnsureCoreWebView2Async(env);
        }
        catch (Exception) { ok = false; }
        if (!ok)
        {
            // No WebView2 runtime: fall back to the default browser (the page keeps the server alive by pinging it)
            await WaitForServer();
            Process.Start(url);
            Close();
            return;
        }
        var s = web.CoreWebView2.Settings;
        s.AreDevToolsEnabled = false;
        s.IsStatusBarEnabled = false;
        s.AreBrowserAcceleratorKeysEnabled = false;
        web.CoreWebView2.NewWindowRequested += delegate (object o, CoreWebView2NewWindowRequestedEventArgs e)
        {
            e.Handled = true;                      // external links open in the user's browser
            try { Process.Start(e.Uri); } catch (Exception) { }
        };
        web.CoreWebView2.DocumentTitleChanged += delegate { Text = web.CoreWebView2.DocumentTitle; };
        await WaitForServer();
        Controls.Add(web);
        web.BringToFront();
        web.CoreWebView2.Navigate(url);
        Controls.Remove(splash);
    }

    async Task WaitForServer()
    {
        for (int i = 0; i < 150 && !Launcher.Ping(port); i++)
            await Task.Delay(200);
    }
}
