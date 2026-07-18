import algosdk from 'algosdk';
import * as algokit from '@algorandfoundation/algokit-utils';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({
  path: path.join(__dirname, '../../backend/.env')
});
async function deployToTestnet() {
  const algodToken = '';
  const algodServer = 'https://testnet-api.algonode.cloud';
  const algodPort = 443;
  const algodClient = new algosdk.Algodv2(algodToken, algodServer, algodPort);
  const mnemonicFromEnv = process.env.MANAGER_MNEMONIC;
  if (!mnemonicFromEnv) {
    throw new Error('MANAGER_MNEMONIC not set in environment');
  }
  const deployerAccount = algosdk.mnemonicToSecretKey(mnemonicFromEnv);
  console.log('Deployer Address:', deployerAccount.addr);
  const accountInfo = await algodClient.accountInformation(deployerAccount.addr).do();
  console.log('Balance:', accountInfo.amount / 1_000_000, 'ALGO');
  if (accountInfo.amount < 1_000_000) {
    throw new Error('Insufficient balance. Please fund your account with testnet ALGO.');
  }
  const artifactsPath = path.join(__dirname, '../artifacts');
  const approvalProgram = fs.readFileSync(path.join(artifactsPath, 'ChitFundSimple.approval.teal'), 'utf8');
  const clearProgram = fs.readFileSync(path.join(artifactsPath, 'ChitFundSimple.clear.teal'), 'utf8');
  const approvalCompiled = await algodClient.compile(approvalProgram).do();
  const clearCompiled = await algodClient.compile(clearProgram).do();
  // Set monthly contribution to 0.1 ALGO (100,000 microAlgos)
  const monthlyContribution = 100_000;
  const commissionPercent = 5;
  const totalMembers = 10;
  console.log('\n=== Deployment Parameters ===');
  console.log('Monthly Contribution:', monthlyContribution / 1_000_000, 'ALGO');
  console.log('Commission:', commissionPercent, '%');
  console.log('Total Members:', totalMembers);
  const params = await algodClient.getTransactionParams().do();
  const onComplete = algosdk.OnApplicationComplete.NoOpOC;
  const methodSelector = algosdk.ABIMethod.fromSignature('createApplication(uint64,uint64,uint64)void').getSelector();
  const uint64Type = algosdk.ABIType.from('uint64');
  const appArgs = [methodSelector, uint64Type.encode(monthlyContribution), uint64Type.encode(commissionPercent), uint64Type.encode(totalMembers)];
  const localInts = 0;
  const localBytes = 0;
  const globalInts = 6;
  const globalBytes = 1;
  const txn = algosdk.makeApplicationCreateTxnFromObject({
    from: deployerAccount.addr,
    suggestedParams: params,
    onComplete,
    approvalProgram: new Uint8Array(Buffer.from(approvalCompiled.result, 'base64')),
    clearProgram: new Uint8Array(Buffer.from(clearCompiled.result, 'base64')),
    numLocalInts: localInts,
    numLocalByteSlices: localBytes,
    numGlobalInts: globalInts,
    numGlobalByteSlices: globalBytes,
    appArgs
  });
  const signedTxn = txn.signTxn(deployerAccount.sk);
  const txId = txn.txID().toString();
  console.log('\nSending transaction...');
  console.log('Transaction ID:', txId);
  await algodClient.sendRawTransaction(signedTxn).do();
  const confirmedTxn = await algosdk.waitForConfirmation(algodClient, txId, 4);
  const appId = confirmedTxn['application-index'];
  console.log('\n=== Deployment Successful ===');
  console.log('Application ID:', appId);
  console.log('Application Address:', algosdk.getApplicationAddress(appId));
  console.log('\nTestNet Explorer:');
  console.log(`https://testnet.explorer.perawallet.app/application/${appId}`);
  console.log(`https://testnet.algoexplorer.io/application/${appId}`);
  // Persist APP_ID to backend/.env and frontend/.env
  const backendEnvPath = path.join(__dirname, '../../backend/.env');
  const frontendEnvPath = path.join(__dirname, '../../frontend/.env');
  const ensureEnvSet = (envPath: string, key: string, value: string) => {
    let content = '';
    try {
      content = fs.readFileSync(envPath, 'utf8');
    } catch {}
    const lines = content ? content.split(/\r?\n/) : [];
    let found = false;
    const updated = lines.map((line) => {
      if (line.startsWith(`${key}=`)) {
        found = true;
        return `${key}=${value}`;
      }
      return line;
    });
    if (!found) updated.push(`${key}=${value}`);
    fs.mkdirSync(path.dirname(envPath), { recursive: true });
    fs.writeFileSync(envPath, updated.join('\n'));
  };
  try {
    ensureEnvSet(backendEnvPath, 'APP_ID', String(appId));
    ensureEnvSet(frontendEnvPath, 'VITE_APP_ID', String(appId));
    console.log('\nWrote APP_ID to backend/.env and VITE_APP_ID to frontend/.env');
  } catch (e) {
    console.warn('Failed to write APP_ID to env files:', e);
  }
  console.log('\n=== Next Steps ===');
  console.log('1. Restart backend and frontend to pick up the new APP_ID');
  console.log('2. Fund the app address if needed for inner transactions');
  console.log('3. Add members using the addMember method');
  console.log('4. Start the chit using the startChit method');
  return appId;
}
deployToTestnet().then(appId => {
  console.log(`\nDeployment complete! App ID: ${appId}`);
  process.exit(0);
}).catch(error => {
  console.error('Deployment failed:', error);
  process.exit(1);
});