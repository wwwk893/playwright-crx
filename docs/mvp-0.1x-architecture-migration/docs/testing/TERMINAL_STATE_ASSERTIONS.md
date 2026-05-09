# Terminal State Assertions

## Why

Generated replay can false-green if the script completes but business state did not change. Every generated replay E2E must verify terminal business state.

## Good assertions

```ts
await expect(page.getByTestId('users-table')).toContainText('alice.qa');
await expect(page.getByTestId('network-resource-table')).toContainText('res-web-01');
await expect(page.getByRole('dialog', { name: '新建用户' })).toBeHidden();
await expect(row).toBeHidden();
await expect(toast).toContainText('保存成功');
```

## Bad assertions

```ts
// Only proves script did not throw.
await replayGeneratedPlaywrightCode(context, code, testInfo);

// Too broad.
await expect(page.locator('body')).toContainText('保存');
```

## For repeat segments

For repeated data rows, verify each row or at least representative row values:

```ts
for (const name of ['pool-a', 'pool-b'])
  await expect(table).toContainText(name);
```
