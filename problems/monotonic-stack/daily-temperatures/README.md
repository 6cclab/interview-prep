# Daily Temperatures

You are given a list of daily temperature readings. For each day, find out how
many days you would have to wait until a warmer temperature. If there is no
future day with a warmer temperature, put `0` for that day instead.

## Constraints

- `1 <= temperatures.length <= 300000`
- `1 <= temperatures[i] <= 1000000`
- A solution that, for each day, scans forward day by day looking for a
  warmer one is too slow and this problem's test suite will reject it, even
  if it returns the right answer.

## Examples

```
temperatures = [73,74,75,71,69,72,76,73]
-> [1,1,4,2,1,1,0,0]

temperatures = [30,40,50,60]
-> [1,1,1,0]

temperatures = [60,50,40,30]
-> [0,0,0,0]

temperatures = [50]
-> [0]
```

## Signature

```ts
export function dailyTemperatures(temperatures: number[]): number[]
```

## Run it

```bash
pnpm test daily-temperatures     # attempt
pnpm reset daily-temperatures    # start over from a clean stub
```
