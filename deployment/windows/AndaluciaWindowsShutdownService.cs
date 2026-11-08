using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

internal static class AndaluciaWindowsShutdownService
{
    private const string ServiceName = "AndaluciaShutdownGuard";
    private const int ServiceWin32OwnProcess = 0x10;
    private const int ServiceAcceptStop = 0x1;
    private const int ServiceAcceptPreshutdown = 0x100;
    private const int ServiceControlStop = 0x1;
    private const int ServiceControlPreshutdown = 0xF;
    private const int ServiceStopped = 0x1;
    private const int ServiceStartPending = 0x2;
    private const int ServiceStopPending = 0x3;
    private const int ServiceRunning = 0x4;
    private static readonly ManualResetEvent Stopped = new ManualResetEvent(false);
    private static IntPtr statusHandle;
    private static ServiceControlHandler handler;
    private static string projectRoot;
    private static string expectedSha;
    private static string gitPath;
    private static string handshakeSha256;
    private static int timeoutSeconds = 45;
    private static int shutdownStarted;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ServiceTableEntry { public string serviceName; public ServiceMain serviceMain; }
    [StructLayout(LayoutKind.Sequential)]
    private struct ServiceStatus { public int serviceType, currentState, controlsAccepted, win32ExitCode, serviceSpecificExitCode, checkPoint, waitHint; }
    private delegate void ServiceMain(int argumentCount, IntPtr arguments);
    private delegate int ServiceControlHandler(int control, int eventType, IntPtr eventData, IntPtr context);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool StartServiceCtrlDispatcher(ServiceTableEntry[] table);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr RegisterServiceCtrlHandlerEx(string serviceName, ServiceControlHandler callback, IntPtr context);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool SetServiceStatus(IntPtr handle, ref ServiceStatus status);

    public static int Main(string[] args)
    {
        try {
            projectRoot = Path.GetFullPath(RequiredValue(args, "--project-root"));
            bool disposableSimulation = Array.IndexOf(args, "--simulate-preshutdown") >= 0;
            if (!disposableSimulation) {
                expectedSha = RequiredValue(args, "--expected-sha").ToLowerInvariant();
                gitPath = Path.GetFullPath(RequiredValue(args, "--git-path"));
                handshakeSha256 = RequiredValue(args, "--handshake-sha256").ToLowerInvariant();
                ValidateSourceBinding();
            }
            int parsed;
            if (Int32.TryParse(OptionalArgument(args, "--timeout-seconds"), out parsed) && parsed >= 5 && parsed <= 60) timeoutSeconds = parsed;
            if (disposableSimulation) return RunGuardedPreshutdown(true);
            handler = HandleControl;
            ServiceMain serviceMain = RunService;
            var table = new[] { new ServiceTableEntry { serviceName = ServiceName, serviceMain = serviceMain }, new ServiceTableEntry() };
            if (!StartServiceCtrlDispatcher(table)) throw new Win32Exception(Marshal.GetLastWin32Error(), "SHUTDOWN_SERVICE_DISPATCHER_FAILED");
            GC.KeepAlive(serviceMain);
            return 0;
        } catch (Exception error) {
            WriteServiceLog("FAILED", error.Message);
            Console.Error.WriteLine(error.Message);
            return 1;
        }
    }

    private static void RunService(int argumentCount, IntPtr arguments)
    {
        statusHandle = RegisterServiceCtrlHandlerEx(ServiceName, handler, IntPtr.Zero);
        if (statusHandle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "SHUTDOWN_SERVICE_HANDLER_REGISTRATION_FAILED");
        Report(ServiceStartPending, 0, 5000);
        Report(ServiceRunning, ServiceAcceptStop | ServiceAcceptPreshutdown, 0);
        WriteServiceLog("ARMED", "sha=" + expectedSha + ";delivery=SCM_PRESHUTDOWN");
        Stopped.WaitOne();
    }

    private static int HandleControl(int control, int eventType, IntPtr eventData, IntPtr context)
    {
        if (control == ServiceControlStop) {
            WriteServiceLog("STOPPED", "control=SERVICE_CONTROL_STOP;databaseShutdownNotRequested=true");
            Report(ServiceStopped, 0, 0);
            Stopped.Set();
            return 0;
        }
        if (control != ServiceControlPreshutdown) return 0;
        if (Interlocked.CompareExchange(ref shutdownStarted, 1, 0) != 0) { WriteServiceLog("DUPLICATE_IGNORED", "control=" + control); return 0; }
        try {
            WriteServiceLog("SIGNALLED", "control=" + control);
            Report(ServiceStopPending, 0, (timeoutSeconds + 5) * 1000);
            int result = RunGuardedPreshutdown(false);
            WriteServiceLog(result == 0 ? "ACKNOWLEDGED" : "FAILED", "handshakeExitCode=" + result);
            Report(ServiceStopped, 0, 0, result == 0 ? 0 : 1);
            Stopped.Set();
            return result;
        } catch (Exception error) {
            WriteServiceLog("FAILED", error.Message);
            Report(ServiceStopped, 0, 0, 1);
            Stopped.Set();
            return 1;
        }
    }

    private static int RunGuardedPreshutdown(bool disposableSimulation)
    {
        if (!disposableSimulation) ValidateSourceBinding();
        string script = Path.Combine(Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location), "Watch-AndaluciaWindowsShutdown.ps1");
        if (!File.Exists(script)) throw new InvalidOperationException("SHUTDOWN_SERVICE_HANDSHAKE_SCRIPT_MISSING");
        if (!disposableSimulation && ComputeSha256(script) != handshakeSha256) throw new InvalidOperationException("SHUTDOWN_SERVICE_HANDSHAKE_INTEGRITY_MISMATCH");
        var start = new ProcessStartInfo {
            FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe"),
            Arguments = BuildPowerShellArguments(script, disposableSimulation),
            WorkingDirectory = projectRoot,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        using (Process process = Process.Start(start)) {
            if (process == null) return 1;
            var standardOutput = new StringBuilder();
            var standardError = new StringBuilder();
            process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs eventArgs) { if (eventArgs.Data != null) standardOutput.AppendLine(eventArgs.Data); };
            process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs eventArgs) { if (eventArgs.Data != null) standardError.AppendLine(eventArgs.Data); };
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            if (!process.WaitForExit((timeoutSeconds + 5) * 1000)) { try { process.Kill(); } catch { } return 1; }
            process.WaitForExit();
            if (process.ExitCode != 0) Console.Error.Write(standardError.ToString() + standardOutput.ToString());
            return process.ExitCode;
        }
    }

    private static string BuildPowerShellArguments(string script, bool disposableSimulation)
    {
        string executionPolicy = disposableSimulation ? "Bypass" : "RemoteSigned";
        string common = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy " + executionPolicy + " -File \"" + script + "\" -ProjectRoot \"" + projectRoot + "\" -TimeoutSeconds " + timeoutSeconds;
        if (!disposableSimulation) return common + " -PreshutdownOnce -ScmValidatedSourceSha " + expectedSha;
        string trigger = Path.Combine(projectRoot, ".runtime", "shutdown-service-simulation.event");
        Directory.CreateDirectory(Path.GetDirectoryName(trigger));
        File.WriteAllText(trigger, "SCM_PRESHUTDOWN_SIMULATION");
        return common + " -SimulationEventPath \"" + trigger + "\"";
    }

    private static void ValidateSourceBinding()
    {
        if (!System.Text.RegularExpressions.Regex.IsMatch(expectedSha ?? "", "^[0-9a-f]{40}$")) throw new InvalidOperationException("SHUTDOWN_SERVICE_EXPECTED_SHA_INVALID");
        if (!System.Text.RegularExpressions.Regex.IsMatch(handshakeSha256 ?? "", "^[0-9a-f]{64}$")) throw new InvalidOperationException("SHUTDOWN_SERVICE_HANDSHAKE_SHA_INVALID");
        if (!File.Exists(gitPath)) throw new InvalidOperationException("SHUTDOWN_SERVICE_GIT_MISSING");
        string common = "-c safe.directory=\"" + projectRoot + "\" -C \"" + projectRoot + "\" ";
        string head = RunGit(common + "rev-parse HEAD").Trim().ToLowerInvariant();
        string branch = RunGit(common + "branch --show-current").Trim();
        if (head != expectedSha || branch != "main") throw new InvalidOperationException("SHUTDOWN_SERVICE_SOURCE_BINDING_MISMATCH");
    }

    private static string ComputeSha256(string path)
    {
        using (var stream = File.OpenRead(path))
        using (var hash = SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
    }

    private static string RunGit(string arguments)
    {
        var start = new ProcessStartInfo { FileName = gitPath, Arguments = arguments, WorkingDirectory = projectRoot, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        using (Process process = Process.Start(start)) {
            if (process == null || !process.WaitForExit(10000)) throw new InvalidOperationException("SHUTDOWN_SERVICE_SOURCE_INSPECTION_FAILED");
            string output = process.StandardOutput.ReadToEnd();
            string error = process.StandardError.ReadToEnd();
            if (process.ExitCode != 0) throw new InvalidOperationException("SHUTDOWN_SERVICE_SOURCE_INSPECTION_FAILED:" + error.Trim());
            return output;
        }
    }

    private static void WriteServiceLog(string state, string detail)
    {
        try {
            if (String.IsNullOrWhiteSpace(projectRoot)) return;
            string directory = Path.Combine(projectRoot, ".runtime", "logs");
            Directory.CreateDirectory(directory);
            string safe = (detail ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", " ").Replace("\n", " ");
            string record = "{\"version\":\"andalucia-windows-shutdown-service-v1\",\"recordedAt\":\"" + DateTime.UtcNow.ToString("o") + "\",\"state\":\"" + state + "\",\"detail\":\"" + safe + "\"}" + Environment.NewLine;
            File.AppendAllText(Path.Combine(directory, "windows-shutdown-service.jsonl"), record);
        } catch { }
    }

    private static void Report(int state, int accepted, int waitHint, int exitCode = 0)
    {
        var status = new ServiceStatus { serviceType = ServiceWin32OwnProcess, currentState = state, controlsAccepted = accepted, win32ExitCode = exitCode, waitHint = waitHint };
        if (!SetServiceStatus(statusHandle, ref status)) throw new Win32Exception(Marshal.GetLastWin32Error(), "SHUTDOWN_SERVICE_STATUS_FAILED");
    }

    private static string RequiredValue(string[] args, string name)
    {
        string value = OptionalArgument(args, name);
        if (String.IsNullOrWhiteSpace(value)) throw new ArgumentException("SHUTDOWN_SERVICE_PROJECT_ROOT_REQUIRED");
        return value;
    }

    private static string OptionalArgument(string[] args, string name)
    {
        for (int i = 0; i + 1 < args.Length; i++) if (String.Equals(args[i], name, StringComparison.OrdinalIgnoreCase)) return args[i + 1];
        return null;
    }
}
