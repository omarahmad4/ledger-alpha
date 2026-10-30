/**
 * @file csv_import.spec.ts
 * @description Playwright E2E smoke tests for Robinhood CSV import flows.
 * Verifies partner selection, multiple activity codes mapping, withdrawal processing, and duplicate prevention.
 */

import { test, expect } from '@playwright/test';
import { execFileSync } from 'child_process';

test.describe('LedgerAlpha CSV Ingestion E2E Tests', () => {
  test.beforeAll(async () => {
    // Never seed or copy a user database. E2E requires an explicit disposable path.
    if (!/^file:\/.*ledger-alpha-e2e\.db$/.test(process.env.DATABASE_URL ?? '')) {
      throw new Error('Set DATABASE_URL=file:/absolute/disposable/path/ledger-alpha-e2e.db and run the test server with the same value.');
    }
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], { stdio: 'ignore' });
    execFileSync('npx', ['tsx', 'prisma/seed.ts'], { stdio: 'ignore' });
  });

  test('should handle raw CSV upload, per-cashflow partner assignment, and duplicate prevention', async ({ page }) => {
    // 1. Navigate to the import page
    await page.goto('/imports');
    await expect(page.locator('h2')).toContainText('Imports');

    // 2. Prepare simulated CSV covering all 19 unique Robinhood activity codes plus dividend reinvestment
    const csvContent = [
      'Trade Date,Activity Type,Symbol,Quantity,Price,Amount,Description',
      '2024-01-01,ACH,,0,,1000.00,ACH Deposit', // DEPOSIT
      '2024-01-02,Buy,AAPL,5,150.00,-750.00,Buy Apple', // BUY
      '2024-01-03,Sell,AAPL,2,160.00,320.00,Sell Apple', // SELL
      '2024-01-04,CDIV,AAPL,,,10.00,Dividend Cash', // DIVIDEND
      '2024-01-05,MDIV,AAPL,,,5.00,Dividend Cash', // DIVIDEND
      '2024-01-06,INT,,,,2.50,Interest', // DIVIDEND
      '2024-01-07,SLIP,AAPL,,,1.20,Dividend Cash', // DIVIDEND
      '2024-01-08,GOLD,,,,10.00,Gold Fee', // FEE
      '2024-01-09,DFEE,,,,2.00,Fee', // FEE
      '2024-01-10,AFEE,,,,1.50,Fee', // FEE
      '2024-01-11,MINT,,,,0.50,Fee', // FEE
      '2024-01-12,BTO,AAPL,,,15.00,Fee', // FEE
      '2024-01-13,STC,AAPL,,,25.00,Dividend Cash', // DIVIDEND
      '2024-01-14,OEXP,AAPL,,,0.00,Fee', // FEE
      '2024-01-15,SPL,AAPL,2,,0.00,Split AAPL', // SPLIT
      '2024-01-16,MRGS,AAPL,-1,,170.00,Sell Apple', // SELL
      '2024-01-17,CONV,AAPL,,,5.00,Dividend Cash', // DIVIDEND
      '2024-01-18,MISC,AAPL,,,3.00,Dividend Cash', // DIVIDEND
      '2024-01-19,CIL,AAPL,,,4.00,Dividend Cash', // DIVIDEND
      '2024-01-20,ACH,,0,,-500.00,ACH Withdrawal', // WITHDRAWAL
      '2024-01-21,Buy,BRK.B,1,350.00,-350.00,Buy Berkshire', // BUY BRK.B
      '2024-01-22,Buy,AAPL,0.1,150.00,-15.00,Dividend Reinvestment', // REINVESTMENT
    ].join('\n');

    // 3. Test File Selector Upload mechanism
    await page.setInputFiles('#csv-file-input', {
      name: 'actual_data_mocked.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csvContent),
    });

    // Verify CSV text state is populated
    const textarea = page.getByTestId('csv-textarea');
    await expect(textarea).not.toHaveValue('');

    // 4. Click Preview and verify normalized sections are rendered
    const previewBtn = page.getByTestId('btn-preview');
    await previewBtn.click();

    // Verify both preview headers are visible
    await expect(page.locator('h3:has-text("Here are all the inflows and outflows")')).toBeVisible();
    await expect(page.locator('h3:has-text("Trades, Dividends, Splits & Fees")')).toBeVisible();

    // Verify that dropdown selectors exist for manual decisions
    const selects = page.locator('select');
    await expect(selects).toHaveCount(2); // One for DEPOSIT, one for WITHDRAWAL

    // Change first cashflow to Partner 1, second cashflow to Partner 2
    await selects.nth(0).selectOption({ index: 0 }); // First owner
    await selects.nth(1).selectOption({ index: 1 }); // Second owner

    // 5. Commit to ledger and verify result output text
    const commitBtn = page.getByTestId('btn-commit');
    await commitBtn.click();

    // Verify successful message (we expect some number of rows committed)
    await expect(page.locator('.form-message')).toContainText('Imported');

    // 6. Navigate to Transactions page to check that Withdrawal is registered
    await page.goto('/transactions');
    await expect(page.locator('table')).toContainText('WITHDRAWAL');

    // 7. Try re-importing the exact same CSV data to check duplicate prevention
    await page.goto('/imports');
    await textarea.fill(csvContent);
    await previewBtn.click();
    await commitBtn.click();

    // Should indicate that all rows were duplicates/skipped
    await expect(page.locator('.form-message')).toContainText('skipped 22 duplicates');

    // 8. Navigate to Decisions page to test Dividend Reinvestment Toggle
    await page.goto('/decisions');
    // By default, the AAPL reinvestment row (staged cost $15.00) should NOT be in the table
    await expect(page.locator('body')).not.toContainText('$15.00');

    // Uncheck "Hide Dividend Reinvestments"
    await page.locator('[data-testid="toggle-reinvestments"]').uncheck();
    // Now the "$15.00" staged cost should be visible
    await expect(page.locator('body')).toContainText('$15.00');

    // Re-check to hide it again
    await page.locator('[data-testid="toggle-reinvestments"]').check();
    await expect(page.locator('body')).not.toContainText('$15.00');
  });
});
