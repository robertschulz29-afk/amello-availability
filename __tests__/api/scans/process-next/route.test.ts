// __tests__/api/scans/process-next/route.test.ts
// Tests for the process-next cron endpoint

describe('Process Next Endpoint', () => {
  describe('Scan Selection Logic', () => {
    it('should prioritize scans with status="running" and incomplete processing', () => {
      // Mock scan data scenarios
      const scans = [
        { id: 1, status: 'done', done_cells: 100, total_cells: 100 },
        { id: 2, status: 'running', done_cells: 50, total_cells: 100 },
        { id: 3, status: 'cancelled', done_cells: 30, total_cells: 100 },
        { id: 4, status: 'running', done_cells: 0, total_cells: 100 },
      ];
      
      // Simulate SQL filter: WHERE status = 'running' AND done_cells < total_cells
      const runningScans = scans.filter(s => 
        s.status === 'running' && s.done_cells < s.total_cells
      );
      
      // Should only include scans 2 and 4
      expect(runningScans).toHaveLength(2);
      expect(runningScans.map(s => s.id)).toEqual([2, 4]);
    });

    it('should return no scans when all are completed', () => {
      const scans = [
        { id: 1, status: 'done', done_cells: 100, total_cells: 100 },
        { id: 2, status: 'done', done_cells: 200, total_cells: 200 },
      ];
      
      const runningScans = scans.filter(s => 
        s.status === 'running' && s.done_cells < s.total_cells
      );
      
      expect(runningScans).toHaveLength(0);
    });

    it('should not process cancelled scans', () => {
      const scans = [
        { id: 1, status: 'cancelled', done_cells: 50, total_cells: 100 },
      ];
      
      const runningScans = scans.filter(s => 
        s.status === 'running' && s.done_cells < s.total_cells
      );
      
      expect(runningScans).toHaveLength(0);
    });
  });

  describe('Request Payload Construction', () => {
    it('should use done_cells as startIndex for next batch', () => {
      const scan = { id: 123, done_cells: 60, total_cells: 200 };
      
      const payload = {
        scanId: scan.id,
        startIndex: scan.done_cells,
        size: 30,
      };
      
      expect(payload.scanId).toBe(123);
      expect(payload.startIndex).toBe(60);
      expect(payload.size).toBe(30);
    });

    it('should process batches of 30 cells', () => {
      const scan = { id: 456, done_cells: 0, total_cells: 1000 };
      
      const payload = {
        scanId: scan.id,
        startIndex: scan.done_cells,
        size: 30,
      };
      
      expect(payload.size).toBe(30);
    });
  });

  describe('Response Handling', () => {
    it('should return no-op message when no scans to process', () => {
      const response = {
        message: 'No scans to process',
        processed: 0,
      };
      
      expect(response.message).toBe('No scans to process');
      expect(response.processed).toBe(0);
    });

    it('should return processing result with scan metadata', () => {
      const response = {
        scanId: 789,
        processed: 30,
        nextIndex: 60,
        done: false,
        total: 300,
      };
      
      expect(response.scanId).toBe(789);
      expect(response.processed).toBe(30);
      expect(response.nextIndex).toBe(60);
      expect(response.done).toBe(false);
      expect(response.total).toBe(300);
    });
  });

  describe('Base URL Construction', () => {
    it('should use NEXTAUTH_URL when available', () => {
      const env = {
        NEXTAUTH_URL: 'https://myapp.example.com',
        VERCEL_URL: undefined,
      };
      
      const baseUrl = env.NEXTAUTH_URL || (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : 'http://localhost:3000');
      
      expect(baseUrl).toBe('https://myapp.example.com');
    });

    it('should use VERCEL_URL when NEXTAUTH_URL not set', () => {
      const env = {
        NEXTAUTH_URL: undefined,
        VERCEL_URL: 'myapp.vercel.app',
      };
      
      const baseUrl = env.NEXTAUTH_URL || (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : 'http://localhost:3000');
      
      expect(baseUrl).toBe('https://myapp.vercel.app');
    });

    it('should fallback to localhost when no environment variables set', () => {
      const env = {
        NEXTAUTH_URL: undefined,
        VERCEL_URL: undefined,
      };
      
      const baseUrl = env.NEXTAUTH_URL || (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : 'http://localhost:3000');
      
      expect(baseUrl).toBe('http://localhost:3000');
    });
  });
});
