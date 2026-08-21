import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
export function createApprover(mode) {
    if (mode === 'always')
        return async () => true;
    if (mode === 'never')
        return async () => false;
    return async (command) => {
        if (!stdin.isTTY)
            return false;
        const reader = createInterface({ input: stdin, output: stdout });
        try {
            stdout.write('\n[ BLOCKED ] Approval required\n');
            stdout.write(`${command}\n`);
            const answer = await reader.question('Allow? [y/N] ');
            return /^y(?:es)?$/i.test(answer.trim());
        }
        finally {
            reader.close();
        }
    };
}
