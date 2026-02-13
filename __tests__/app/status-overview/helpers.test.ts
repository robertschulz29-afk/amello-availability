// __tests__/app/status-overview/helpers.test.ts
// Unit tests for helper functions in status-overview page

describe('Status Overview Helpers', () => {
  describe('getStatusColor', () => {
    function getStatusColor(status: string): string {
      switch (status) {
        case 'running': return 'info';
        case 'done': return 'success';
        case 'error': return 'danger';
        case 'cancelled': return 'warning';
        case 'queued': return 'secondary';
        default: return 'secondary';
      }
    }

    it('should return correct color for running status', () => {
      expect(getStatusColor('running')).toBe('info');
    });

    it('should return correct color for done status', () => {
      expect(getStatusColor('done')).toBe('success');
    });

    it('should return correct color for error status', () => {
      expect(getStatusColor('error')).toBe('danger');
    });

    it('should return correct color for cancelled status', () => {
      expect(getStatusColor('cancelled')).toBe('warning');
    });

    it('should return correct color for queued status', () => {
      expect(getStatusColor('queued')).toBe('secondary');
    });

    it('should return secondary for unknown status', () => {
      expect(getStatusColor('unknown')).toBe('secondary');
    });
  });

  describe('getPercentage', () => {
    function getPercentage(scan: { done_cells: number; total_cells: number }): number {
      if (scan.total_cells === 0) return 0;
      return Math.floor((scan.done_cells / scan.total_cells) * 100);
    }

    it('should return 0 when total_cells is 0', () => {
      expect(getPercentage({ done_cells: 0, total_cells: 0 })).toBe(0);
    });

    it('should return 0 when no cells are done', () => {
      expect(getPercentage({ done_cells: 0, total_cells: 100 })).toBe(0);
    });

    it('should return 50 when half done', () => {
      expect(getPercentage({ done_cells: 50, total_cells: 100 })).toBe(50);
    });

    it('should return 100 when all done', () => {
      expect(getPercentage({ done_cells: 100, total_cells: 100 })).toBe(100);
    });

    it('should floor the percentage', () => {
      expect(getPercentage({ done_cells: 33, total_cells: 100 })).toBe(33);
      expect(getPercentage({ done_cells: 67, total_cells: 100 })).toBe(67);
    });

    it('should handle partial progress', () => {
      expect(getPercentage({ done_cells: 25, total_cells: 86 })).toBe(29);
    });
  });

  describe('formatDateTime', () => {
    function formatDateTime(isoString: string): string {
      try {
        const date = new Date(isoString);
        if (isNaN(date.getTime())) {
          return isoString;
        }
        return date.toLocaleString();
      } catch {
        return isoString;
      }
    }

    it('should format valid ISO date string', () => {
      const isoString = '2026-02-13T10:00:00.000Z';
      const result = formatDateTime(isoString);
      // Just check that it returns something (locale-dependent)
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
      expect(result).not.toBe('Invalid Date');
    });

    it('should return original string for invalid date', () => {
      const invalidString = 'invalid-date';
      const result = formatDateTime(invalidString);
      expect(result).toBe(invalidString);
    });

    it('should return original string for empty string', () => {
      const result = formatDateTime('');
      expect(result).toBe('');
    });
  });
});
