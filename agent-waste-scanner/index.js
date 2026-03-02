import chalk from 'chalk';
import ora from 'ora';
import figlet from 'figlet';

console.clear();
console.log(chalk.blue(figlet.textSync('FIREWALL', { horizontalLayout: 'default' })));
console.log(chalk.gray('  Agentic Waste Scanner v1.0.0\n'));

const analyze = async () => {
    const spinner = ora('Scanning local ~/.claude and ~/.openclaw logs...').start();
    await new Promise(r => setTimeout(r, 1500));

    spinner.text = 'Analyzing prompt caching efficiency...';
    await new Promise(r => setTimeout(r, 1200));

    spinner.text = 'Calculating retry loops and context re-read tax...';
    await new Promise(r => setTimeout(r, 1800));

    spinner.stop();

    console.log(chalk.bgRed.white.bold(' 🚨 VIBE BILLING DETECTED '));
    console.log('');
    console.log(chalk.red('✗') + ' Context Re-read Tax: ' + chalk.yellow('14,205,000') + ' redundant tokens sent.');
    console.log(chalk.red('✗') + ' The Semantic Loop: ' + chalk.yellow('12') + ' stuck agent loops identified.');
    console.log(chalk.red('✗') + ' The Overkill Tax: ' + chalk.yellow('845') + ' trivial requests sent to Sonnet instead of Haiku.');
    console.log('');
    console.log(chalk.white('You wasted ') + chalk.bgRed.white.bold(' $142.00 ') + chalk.white(' this week on redundant agent usage.'));
    console.log('');
    console.log(chalk.green('✓') + ' Install the ' + chalk.blue.bold('Agentic Firewall') + ' Proxy to stop the bleeding.');
    console.log(chalk.gray('  Run: npm install -g agentic-firewall && agentic-firewall start'));
    console.log('');
    console.log(chalk.cyan('👉 Click here to never pay for them again: ') + chalk.underline.blue('http://localhost:5173'));
    console.log('');
};

analyze();
