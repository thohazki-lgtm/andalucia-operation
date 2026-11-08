Set-StrictMode -Version Latest

if (-not ('Andalucia.NativeTcpTable' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Net;
using System.Runtime.InteropServices;

namespace Andalucia {
    public sealed class TcpListenerOwner {
        public string LocalAddress { get; set; }
        public int LocalPort { get; set; }
        public int OwningProcess { get; set; }
    }

    public static class NativeTcpTable {
        private const int AddressFamilyInterNetwork = 2;
        private const uint ErrorInsufficientBuffer = 122;

        private enum TcpTableClass {
            TcpTableOwnerPidListener = 3
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct TcpRowOwnerPid {
            public uint State;
            public uint LocalAddress;
            public uint LocalPort;
            public uint RemoteAddress;
            public uint RemotePort;
            public uint OwningPid;
        }

        [DllImport("iphlpapi.dll", SetLastError = true)]
        private static extern uint GetExtendedTcpTable(
            IntPtr table,
            ref int size,
            bool order,
            int ipVersion,
            TcpTableClass tableClass,
            uint reserved);

        public static TcpListenerOwner[] GetListeners() {
            int size = 0;
            uint result = GetExtendedTcpTable(IntPtr.Zero, ref size, true, AddressFamilyInterNetwork, TcpTableClass.TcpTableOwnerPidListener, 0);
            if (result != ErrorInsufficientBuffer) throw new Win32Exception((int)result, "Unable to size the Windows TCP listener table.");
            IntPtr buffer = Marshal.AllocHGlobal(size);
            try {
                result = GetExtendedTcpTable(buffer, ref size, true, AddressFamilyInterNetwork, TcpTableClass.TcpTableOwnerPidListener, 0);
                if (result != 0) throw new Win32Exception((int)result, "Unable to read the Windows TCP listener table.");
                int count = Marshal.ReadInt32(buffer);
                int rowSize = Marshal.SizeOf(typeof(TcpRowOwnerPid));
                IntPtr rowPointer = IntPtr.Add(buffer, sizeof(int));
                var listeners = new List<TcpListenerOwner>(count);
                for (int index = 0; index < count; index++) {
                    var row = (TcpRowOwnerPid)Marshal.PtrToStructure(rowPointer, typeof(TcpRowOwnerPid));
                    listeners.Add(new TcpListenerOwner {
                        LocalAddress = new IPAddress(row.LocalAddress).ToString(),
                        LocalPort = (ushort)IPAddress.NetworkToHostOrder((short)(row.LocalPort & 0xffff)),
                        OwningProcess = checked((int)row.OwningPid)
                    });
                    rowPointer = IntPtr.Add(rowPointer, rowSize);
                }
                return listeners.ToArray();
            } finally {
                Marshal.FreeHGlobal(buffer);
            }
        }
    }
}
'@
}

function Get-AndaluciaNativeTcpListeners {
    try {
        return @([Andalucia.NativeTcpTable]::GetListeners())
    } catch {
        throw "RUNTIME_LISTENER_OBSERVER_FAILED:$($_.Exception.Message)"
    }
}

function Get-AndaluciaStableRuntimeListeners {
    [CmdletBinding()]
    param(
        [int[]]$RequiredPorts = @(3001, 5173),
        [int[]]$ForbiddenPorts = @(5174),
        [ValidateRange(2, 10)]
        [int]$RequiredStableSamples = 3,
        [ValidateRange(2, 20)]
        [int]$MaximumAttempts = 5,
        [ValidateRange(0, 5000)]
        [int]$SampleDelayMilliseconds = 250,
        [scriptblock]$ConnectionProvider,
        [scriptblock]$DelayProvider
    )

    if ($MaximumAttempts -lt $RequiredStableSamples) {
        throw 'RUNTIME_LISTENER_PROBE_CONFIGURATION_INVALID'
    }
    if (-not $ConnectionProvider) {
        $ConnectionProvider = { @(Get-AndaluciaNativeTcpListeners) }
    }
    if (-not $DelayProvider) {
        $DelayProvider = { param([int]$Milliseconds) Start-Sleep -Milliseconds $Milliseconds }
    }

    $portsOfInterest = @($RequiredPorts + $ForbiddenPorts | Sort-Object -Unique)
    $evidence = @()
    $stableSignature = $null
    $stableSamples = 0

    for ($attempt = 1; $attempt -le $MaximumAttempts; $attempt += 1) {
        $listeners = @(& $ConnectionProvider | Where-Object { $_.LocalPort -in $portsOfInterest })
        $requiredCounts = [ordered]@{}
        foreach ($port in $RequiredPorts) {
            $requiredCounts[[string]$port] = @($listeners | Where-Object LocalPort -eq $port).Count
        }
        $forbiddenCounts = [ordered]@{}
        foreach ($port in $ForbiddenPorts) {
            $forbiddenCounts[[string]$port] = @($listeners | Where-Object LocalPort -eq $port).Count
        }

        $validCounts = @($requiredCounts.Values | Where-Object { $_ -ne 1 }).Count -eq 0 -and
            @($forbiddenCounts.Values | Where-Object { $_ -ne 0 }).Count -eq 0
        $signature = if ($validCounts) {
            (($listeners | Where-Object LocalPort -in $RequiredPorts | Sort-Object LocalPort, OwningProcess | ForEach-Object {
                '{0}:{1}' -f $_.LocalPort, $_.OwningProcess
            }) -join ',')
        } else { $null }

        if ($validCounts -and $signature -eq $stableSignature) {
            $stableSamples += 1
        } elseif ($validCounts) {
            $stableSignature = $signature
            $stableSamples = 1
        } else {
            $stableSignature = $null
            $stableSamples = 0
        }

        $evidence += [ordered]@{
            attempt = $attempt
            requiredCounts = $requiredCounts
            forbiddenCounts = $forbiddenCounts
            listeners = @($listeners | Select-Object LocalAddress, LocalPort, OwningProcess)
            signature = $signature
            consecutiveStableSamples = $stableSamples
        }

        if ($validCounts -and $stableSamples -ge $RequiredStableSamples) {
            return [pscustomobject]@{
                Listeners = @($listeners | Where-Object LocalPort -in $RequiredPorts)
                Attempts = $attempt
                StableSamples = $stableSamples
                Evidence = $evidence
            }
        }
        if ($attempt -lt $MaximumAttempts -and $SampleDelayMilliseconds -gt 0) {
            & $DelayProvider $SampleDelayMilliseconds
        }
    }

    throw "RUNTIME_LISTENER_AMBIGUOUS:$($evidence | ConvertTo-Json -Compress -Depth 6)"
}

Export-ModuleMember -Function Get-AndaluciaStableRuntimeListeners
