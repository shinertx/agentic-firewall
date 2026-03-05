import { describe, it, expect, beforeEach } from 'vitest';
import {
    recordTelemetryEvent,
    getInstallStats,
    getInstallBreakdown,
    getUniqueInstallCount,
    exportInstallData,
    importInstallData,
    clearInstalls,
    TelemetryEvent,
} from '../src/installTracker';

function makeEvent(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
    return {
        event: 'cli_invocation',
        command: 'setup',
        machineId: 'test-machine-001',
        installId: 'test-uuid-001',
        version: '0.5.9',
        platform: 'darwin',
        arch: 'arm64',
        node: 'v20.11.0',
        isFirstRun: true,
        timestamp: new Date().toISOString(),
        ...overrides,
    };
}

describe('Install Tracker', () => {
    beforeEach(() => {
        clearInstalls();
    });

    it('should record a new install on first telemetry event', () => {
        recordTelemetryEvent(makeEvent());

        const stats = getInstallStats();
        expect(stats.uniqueInstalls).toBe(1);
        expect(stats.totalInstalls).toBe(1);
        expect(stats.platformBreakdown.darwin).toBe(1);
        expect(stats.archBreakdown.arm64).toBe(1);
        expect(stats.versionBreakdown['0.5.9']).toBe(1);
    });

    it('should dedup by machineId on subsequent pings', () => {
        const machineId = 'dedup-machine';
        recordTelemetryEvent(makeEvent({ machineId }));
        recordTelemetryEvent(makeEvent({ machineId, command: 'status', isFirstRun: false }));
        recordTelemetryEvent(makeEvent({ machineId, command: 'scan', isFirstRun: false }));

        const stats = getInstallStats();
        expect(stats.uniqueInstalls).toBe(1);
        expect(stats.totalInstalls).toBe(3); // totalPings
        expect(getUniqueInstallCount()).toBe(1);
    });

    it('should track command counts correctly', () => {
        const machineId = 'cmd-test';
        recordTelemetryEvent(makeEvent({ machineId, command: 'setup' }));
        recordTelemetryEvent(makeEvent({ machineId, command: 'scan' }));
        recordTelemetryEvent(makeEvent({ machineId, command: 'scan' }));
        recordTelemetryEvent(makeEvent({ machineId, command: 'status' }));
        recordTelemetryEvent(makeEvent({ machineId, command: 'run' }));

        const data = exportInstallData();
        expect(data[machineId].commandCounts.setup).toBe(1);
        expect(data[machineId].commandCounts.scan).toBe(2);
        expect(data[machineId].commandCounts.status).toBe(1);
        expect(data[machineId].commandCounts.run).toBe(1);
        expect(data[machineId].totalPings).toBe(5);
    });

    it('should count unknown commands as other', () => {
        const machineId = 'other-cmd';
        recordTelemetryEvent(makeEvent({ machineId, command: '--help' }));
        recordTelemetryEvent(makeEvent({ machineId, command: 'foobar' }));

        const data = exportInstallData();
        expect(data[machineId].commandCounts.other).toBe(2);
    });

    it('should track multiple unique machines separately', () => {
        recordTelemetryEvent(makeEvent({ machineId: 'm1', platform: 'darwin' }));
        recordTelemetryEvent(makeEvent({ machineId: 'm2', platform: 'linux' }));
        recordTelemetryEvent(makeEvent({ machineId: 'm3', platform: 'linux', arch: 'x64' }));

        const stats = getInstallStats();
        expect(stats.uniqueInstalls).toBe(3);
        expect(stats.platformBreakdown.darwin).toBe(1);
        expect(stats.platformBreakdown.linux).toBe(2);
        expect(stats.archBreakdown.arm64).toBe(2);
        expect(stats.archBreakdown.x64).toBe(1);
    });

    it('should export and import data correctly (round-trip)', () => {
        recordTelemetryEvent(makeEvent({ machineId: 'rt-1', command: 'setup' }));
        recordTelemetryEvent(makeEvent({ machineId: 'rt-1', command: 'scan' }));
        recordTelemetryEvent(makeEvent({ machineId: 'rt-2', platform: 'win32' }));

        const exported = exportInstallData();
        expect(Object.keys(exported)).toHaveLength(2);

        // Clear and re-import
        clearInstalls();
        expect(getUniqueInstallCount()).toBe(0);

        importInstallData(exported);
        expect(getUniqueInstallCount()).toBe(2);

        const stats = getInstallStats();
        expect(stats.totalInstalls).toBe(3);
        expect(exported['rt-1'].commandCounts.setup).toBe(1);
        expect(exported['rt-1'].commandCounts.scan).toBe(1);
    });

    it('should return correct public breakdown (no individual records)', () => {
        recordTelemetryEvent(makeEvent({ machineId: 'b1', platform: 'darwin', version: '0.5.8' }));
        recordTelemetryEvent(makeEvent({ machineId: 'b2', platform: 'linux', version: '0.5.9' }));

        const breakdown = getInstallBreakdown();
        expect(breakdown.uniqueInstalls).toBe(2);
        expect(breakdown.platformBreakdown.darwin).toBe(1);
        expect(breakdown.platformBreakdown.linux).toBe(1);
        expect(breakdown.versionBreakdown['0.5.8']).toBe(1);
        expect(breakdown.versionBreakdown['0.5.9']).toBe(1);
        // Should NOT have installs array (public endpoint)
        expect((breakdown as any).installs).toBeUndefined();
    });

    it('should update lastSeen and lastVersion on repeat pings', () => {
        const machineId = 'update-test';
        const t1 = '2026-01-01T00:00:00Z';
        const t2 = '2026-03-04T12:00:00Z';

        recordTelemetryEvent(makeEvent({ machineId, timestamp: t1, version: '0.5.8' }));
        recordTelemetryEvent(makeEvent({ machineId, timestamp: t2, version: '0.5.9' }));

        const data = exportInstallData();
        expect(data[machineId].firstSeen).toBe(t1);
        expect(data[machineId].lastSeen).toBe(t2);
        expect(data[machineId].lastVersion).toBe('0.5.9');
    });

    it('should handle clearInstalls correctly', () => {
        recordTelemetryEvent(makeEvent({ machineId: 'clear-1' }));
        recordTelemetryEvent(makeEvent({ machineId: 'clear-2' }));
        expect(getUniqueInstallCount()).toBe(2);

        clearInstalls();
        expect(getUniqueInstallCount()).toBe(0);
        expect(getInstallStats().totalInstalls).toBe(0);
    });
});
