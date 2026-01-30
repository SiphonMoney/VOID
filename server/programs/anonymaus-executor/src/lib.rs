//! Void Executor Program - Native Solana Implementation
//! 
//! This program manages user deposits and executes transactions based on signed intents.
//! No Anchor framework - pure native Solana program.

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    hash::hash,
    instruction::{AccountMeta, Instruction},
    msg,
    program::{get_return_data, invoke, invoke_signed},
    program_error::ProgramError,
    program_pack::{IsInitialized, Pack, Sealed},
    pubkey::Pubkey,
    sysvar::{rent::Rent, Sysvar},
    system_instruction,
};

// Program ID - will be replaced during build with actual program ID
// Using a placeholder that's 32 bytes when base58 decoded
solana_program::declare_id!("11111111111111111111111111111111");

mod inco_lightning_program {
    solana_program::declare_id!("5sjEbPiqgZrYwR31ahR6Uk9wf5awoX61YGg7jExQSwaj");
}

// Entry point
entrypoint!(process_instruction);

// Instruction discriminator constants
const INITIALIZE: u8 = 0;
const DEPOSIT: u8 = 1;
const WITHDRAW: u8 = 2;
const EXECUTE_WITH_INTENT: u8 = 3;

fn inco_sighash(name: &str) -> [u8; 8] {
    let preimage = format!("{}:{}", "global", name);
    let mut sighash_bytes = [0u8; 8];
    sighash_bytes.copy_from_slice(&hash(preimage.as_bytes()).to_bytes()[..8]);
    sighash_bytes
}

fn inco_return_u128() -> Result<u128, ProgramError> {
    let (_program_id, return_data) = get_return_data().ok_or(ProgramError::InvalidAccountData)?;
    if return_data.len() < 16 {
        return Err(ProgramError::InvalidAccountData);
    }
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&return_data[..16]);
    Ok(u128::from_le_bytes(bytes))
}

fn inco_new_euint128(
    signer: &AccountInfo,
    inco_program: &AccountInfo,
    ciphertext: &[u8],
    input_type: u8,
) -> Result<u128, ProgramError> {
    let mut data = Vec::with_capacity(8 + 4 + ciphertext.len() + 1);
    data.extend_from_slice(&inco_sighash("new_euint128"));
    data.extend_from_slice(&(ciphertext.len() as u32).to_le_bytes());
    data.extend_from_slice(ciphertext);
    data.push(input_type);

    let ix = Instruction {
        program_id: inco_lightning_program::ID,
        accounts: vec![AccountMeta::new(*signer.key, true)],
        data,
    };

    invoke(&ix, &[signer.clone(), inco_program.clone()])?;
    inco_return_u128()
}

fn inco_as_euint128(
    signer: &AccountInfo,
    inco_program: &AccountInfo,
    value: u128,
) -> Result<u128, ProgramError> {
    let mut data = Vec::with_capacity(8 + 16);
    data.extend_from_slice(&inco_sighash("as_euint128"));
    data.extend_from_slice(&value.to_le_bytes());

    let ix = Instruction {
        program_id: inco_lightning_program::ID,
        accounts: vec![AccountMeta::new(*signer.key, true)],
        data,
    };

    invoke(&ix, &[signer.clone(), inco_program.clone()])?;
    inco_return_u128()
}

fn inco_e_add(
    signer: &AccountInfo,
    inco_program: &AccountInfo,
    lhs: u128,
    rhs: u128,
) -> Result<u128, ProgramError> {
    let mut data = Vec::with_capacity(8 + 16 + 16 + 1);
    data.extend_from_slice(&inco_sighash("e_add"));
    data.extend_from_slice(&lhs.to_le_bytes());
    data.extend_from_slice(&rhs.to_le_bytes());
    data.push(0);

    let ix = Instruction {
        program_id: inco_lightning_program::ID,
        accounts: vec![AccountMeta::new(*signer.key, true)],
        data,
    };

    invoke(&ix, &[signer.clone(), inco_program.clone()])?;
    inco_return_u128()
}

fn inco_e_sub(
    signer: &AccountInfo,
    inco_program: &AccountInfo,
    lhs: u128,
    rhs: u128,
) -> Result<u128, ProgramError> {
    let mut data = Vec::with_capacity(8 + 16 + 16 + 1);
    data.extend_from_slice(&inco_sighash("e_sub"));
    data.extend_from_slice(&lhs.to_le_bytes());
    data.extend_from_slice(&rhs.to_le_bytes());
    data.push(0);

    let ix = Instruction {
        program_id: inco_lightning_program::ID,
        accounts: vec![AccountMeta::new(*signer.key, true)],
        data,
    };

    invoke(&ix, &[signer.clone(), inco_program.clone()])?;
    inco_return_u128()
}

fn inco_e_ge(
    signer: &AccountInfo,
    inco_program: &AccountInfo,
    lhs: u128,
    rhs: u128,
) -> Result<u128, ProgramError> {
    let mut data = Vec::with_capacity(8 + 16 + 16 + 1);
    data.extend_from_slice(&inco_sighash("e_ge"));
    data.extend_from_slice(&lhs.to_le_bytes());
    data.extend_from_slice(&rhs.to_le_bytes());
    data.push(0);

    let ix = Instruction {
        program_id: inco_lightning_program::ID,
        accounts: vec![AccountMeta::new(*signer.key, true)],
        data,
    };

    invoke(&ix, &[signer.clone(), inco_program.clone()])?;
    inco_return_u128()
}

fn inco_e_eq(
    signer: &AccountInfo,
    inco_program: &AccountInfo,
    lhs: u128,
    rhs: u128,
) -> Result<u128, ProgramError> {
    let mut data = Vec::with_capacity(8 + 16 + 16 + 1);
    data.extend_from_slice(&inco_sighash("e_eq"));
    data.extend_from_slice(&lhs.to_le_bytes());
    data.extend_from_slice(&rhs.to_le_bytes());
    data.push(0);

    let ix = Instruction {
        program_id: inco_lightning_program::ID,
        accounts: vec![AccountMeta::new(*signer.key, true)],
        data,
    };

    invoke(&ix, &[signer.clone(), inco_program.clone()])?;
    inco_return_u128()
}

/// Main entry point for processing instructions
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    if instruction_data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }

    let instruction = instruction_data[0];
    
    match instruction {
        INITIALIZE => initialize(program_id, accounts, &instruction_data[1..])?,
        DEPOSIT => deposit(program_id, accounts, &instruction_data[1..])?,
        WITHDRAW => withdraw(program_id, accounts, &instruction_data[1..])?,
        EXECUTE_WITH_INTENT => execute_with_intent(program_id, accounts, &instruction_data[1..])?,
        _ => return Err(ProgramError::InvalidInstructionData),
    }
    
    Ok(())
}

/// Initialize the executor program
/// 
/// Accounts expected:
/// 0. [writable, signer] Executor PDA (seeds: ["executor"])
/// 1. [signer] Authority
/// 2. [] System Program
/// 
/// Instruction data: execution_account (32 bytes)
fn initialize(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    msg!("Initialize executor program");
    
    let accounts_iter = &mut accounts.iter();
    
    let executor_account = next_account_info(accounts_iter)?;
    let authority = next_account_info(accounts_iter)?;
    let system_program = next_account_info(accounts_iter)?;
    
    // Verify executor is a PDA
    let (executor_pda, bump) = Pubkey::find_program_address(
        &[b"executor"],
        program_id,
    );
    
    if executor_account.key != &executor_pda {
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Verify authority is signer
    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Parse execution account from instruction data
    if data.len() < 32 {
        return Err(ProgramError::InvalidInstructionData);
    }
    
    let mut execution_account_bytes = [0u8; 32];
    execution_account_bytes.copy_from_slice(&data[0..32]);
    let execution_account = Pubkey::new_from_array(execution_account_bytes);
    
    // Check if account exists and create it if needed
    let rent = Rent::get()?;
    let account_size = Executor::LEN;
    let rent_exempt_balance = rent.minimum_balance(account_size);
    
    // If account doesn't exist (no lamports), create it
    if executor_account.lamports() == 0 {
        msg!("Creating executor PDA account with {} lamports", rent_exempt_balance);
        
        // Create account instruction - authority pays for the account
        let create_account_ix = system_instruction::create_account(
            authority.key,
            executor_account.key,
            rent_exempt_balance,
            account_size as u64,
            program_id,
        );
        
        // Invoke with PDA signing (the PDA signs for itself)
        invoke_signed(
            &create_account_ix,
            &[
                authority.clone(),
                executor_account.clone(),
                system_program.clone(),
            ],
            &[&[b"executor", &[bump]]],
        )?;
        
        msg!("Executor PDA account created");
    }
    
    // Initialize executor account
    let executor_data = Executor {
        execution_account,
        authority: *authority.key,
        is_initialized: true,
    };
    
    executor_data.pack_into_slice(&mut executor_account.data.borrow_mut());
    
    msg!("Executor initialized with execution account: {}", execution_account);
    
    Ok(())
}

/// Deposit SOL to the vault
/// 
/// Accounts expected:
/// 0. [writable] Vault PDA (seeds: ["vault"])
/// 1. [writable, signer] User
/// 2. [writable] User Deposit PDA (seeds: ["user_deposit", user.key()])
/// 3. [] Inco Lightning Program
/// 3. [] System Program
/// 4. [] Inco Lightning Program
/// 
/// Instruction data:
/// - amount (8 bytes, little-endian u64)
/// - ciphertext_len (4 bytes, little-endian u32)
/// - ciphertext (variable)
/// - input_type (1 byte)
fn deposit(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    msg!("Deposit SOL to vault (v2.1)");
    
    let accounts_iter = &mut accounts.iter();
    
    let vault_account = next_account_info(accounts_iter)?;
    let user_account = next_account_info(accounts_iter)?;
    let user_deposit_account = next_account_info(accounts_iter)?;
    let inco_program = next_account_info(accounts_iter)?;
    let system_program = next_account_info(accounts_iter)?;
    let inco_program = next_account_info(accounts_iter)?;
    
    // Verify user is signer
    if !user_account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Verify vault PDA
    let (vault_pda, _) = Pubkey::find_program_address(
        &[b"vault"],
        program_id,
    );
    
    if vault_account.key != &vault_pda {
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Verify user deposit PDA
    let (user_deposit_pda, _) = Pubkey::find_program_address(
        &[b"user_deposit", user_account.key.as_ref()],
        program_id,
    );
    
    if user_deposit_account.key != &user_deposit_pda {
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Parse amount from instruction data
    if data.len() < 13 {
        return Err(ProgramError::InvalidInstructionData);
    }
    
    let amount = u64::from_le_bytes([
        data[0], data[1], data[2], data[3],
        data[4], data[5], data[6], data[7],
    ]);
    let ciphertext_len = u32::from_le_bytes([data[8], data[9], data[10], data[11]]) as usize;
    if data.len() < 12 + ciphertext_len + 1 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let ciphertext_start = 12;
    let ciphertext_end = ciphertext_start + ciphertext_len;
    let ciphertext = &data[ciphertext_start..ciphertext_end];
    let input_type = data[ciphertext_end];
    
    if amount == 0 {
        return Err(ProgramError::InvalidArgument);
    }

    // Create vault PDA account if it doesn't exist
    let rent = Rent::get()?;
    if vault_account.lamports() == 0 {
        let (vault_pda, bump) = Pubkey::find_program_address(
            &[b"vault"],
            program_id,
        );
        if vault_account.key != &vault_pda {
            return Err(ProgramError::InvalidAccountData);
        }

        let rent_exempt_balance = rent.minimum_balance(0);
        msg!("Creating vault PDA account with {} lamports", rent_exempt_balance);

        let create_vault_ix = system_instruction::create_account(
            user_account.key,
            vault_account.key,
            rent_exempt_balance,
            0,
            program_id,
        );

        invoke_signed(
            &create_vault_ix,
            &[
                user_account.clone(),
                vault_account.clone(),
                system_program.clone(),
            ],
            &[&[b"vault", &[bump]]],
        )?;

        msg!("Vault PDA account created");
    }
    
    // Transfer SOL from user to vault
    invoke(
        &system_instruction::transfer(
            user_account.key,
            vault_account.key,
            amount,
        ),
        &[
            user_account.clone(),
            vault_account.clone(),
            system_program.clone(),
        ],
    )?;
    
    // Create user deposit account if it doesn't exist
    let rent = Rent::get()?;
    let account_size = UserDeposit::LEN;
    let rent_exempt_balance = rent.minimum_balance(account_size);
    
    if user_deposit_account.lamports() == 0 {
        // Account doesn't exist - create it
        msg!("Creating user deposit PDA account");
        
        let create_account_ix = system_instruction::create_account(
            user_account.key,
            user_deposit_account.key,
            rent_exempt_balance,
            account_size as u64,
            program_id,
        );
        
        // Invoke with PDA signing
        let (_user_deposit_pda, bump) = Pubkey::find_program_address(
            &[b"user_deposit", user_account.key.as_ref()],
            program_id,
        );
        
        invoke_signed(
            &create_account_ix,
            &[
                user_account.clone(),
                user_deposit_account.clone(),
                system_program.clone(),
            ],
            &[&[b"user_deposit", user_account.key.as_ref(), &[bump]]],
        )?;
        
        msg!("User deposit PDA account created");
    }
    
    // Update user deposit encrypted balance
    let deposit_data = user_deposit_account.data.borrow();
    let deposit_data_len = deposit_data.len();
    if deposit_data_len < UserDeposit::LEN {
        msg!(
            "User deposit account has invalid size: {} (expected {})",
            deposit_data_len,
            UserDeposit::LEN
        );
        return Err(ProgramError::InvalidAccountData);
    }

    let is_uninitialized = deposit_data.get(0).copied().unwrap_or(0) == 0;
    drop(deposit_data);

    let mut user_deposit = if is_uninitialized {
        // Initialize if new account (just created)
        UserDeposit {
            user: *user_account.key,
            balance: 0,
        }
    } else {
        // Unpack existing account
        UserDeposit::unpack(&user_deposit_account.data.borrow())?
    };
    
    if user_deposit.balance == 0 {
        user_deposit.user = *user_account.key;
        user_deposit.balance = inco_as_euint128(user_account, inco_program, 0)?;
    }

    let encrypted_amount = inco_new_euint128(user_account, inco_program, ciphertext, input_type)?;
    user_deposit.balance = inco_e_add(user_account, inco_program, user_deposit.balance, encrypted_amount)?;
    
    user_deposit.pack_into_slice(&mut user_deposit_account.data.borrow_mut());
    
    msg!("Deposited {} lamports (encrypted balance updated)", amount);
    
    Ok(())
}

/// Withdraw SOL from the vault
/// 
/// Accounts expected:
/// 0. [writable] Vault PDA (seeds: ["vault"])
/// 1. [writable, signer] User
/// 2. [writable] User Deposit PDA (seeds: ["user_deposit", user.key()])
/// 
/// Instruction data: amount (8 bytes, little-endian u64)
fn withdraw(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    msg!("Withdraw SOL from vault");
    
    let accounts_iter = &mut accounts.iter();
    
    let vault_account = next_account_info(accounts_iter)?;
    let user_account = next_account_info(accounts_iter)?;
    let user_deposit_account = next_account_info(accounts_iter)?;
    
    // Verify user is signer
    if !user_account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Verify vault PDA
    let (vault_pda, _) = Pubkey::find_program_address(
        &[b"vault"],
        program_id,
    );
    
    if vault_account.key != &vault_pda {
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Verify user deposit PDA
    let (user_deposit_pda, _) = Pubkey::find_program_address(
        &[b"user_deposit", user_account.key.as_ref()],
        program_id,
    );
    
    if user_deposit_account.key != &user_deposit_pda {
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Parse amount from instruction data
    if data.len() < 8 {
        return Err(ProgramError::InvalidInstructionData);
    }
    
    let amount = u64::from_le_bytes([
        data[0], data[1], data[2], data[3],
        data[4], data[5], data[6], data[7],
    ]);
    
    // Unpack user deposit
    let mut user_deposit = UserDeposit::unpack(&user_deposit_account.data.borrow())?;
    
    // Verify user owns this deposit
    if user_deposit.user != *user_account.key {
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Encrypted balance check
    let encrypted_amount = inco_as_euint128(user_account, inco_program, amount as u128)?;
    let sufficient = inco_e_ge(user_account, inco_program, user_deposit.balance, encrypted_amount)?;
    if sufficient == 0 {
        msg!("Insufficient encrypted balance");
        return Err(ProgramError::InsufficientFunds);
    }
    
    // Update encrypted balance
    user_deposit.balance = inco_e_sub(user_account, inco_program, user_deposit.balance, encrypted_amount)?;
    
    user_deposit.pack_into_slice(&mut user_deposit_account.data.borrow_mut());
    
    // Transfer SOL from vault to user
    **vault_account.try_borrow_mut_lamports()? -= amount;
    **user_account.try_borrow_mut_lamports()? += amount;
    
    msg!("Withdrew {} lamports (encrypted balance updated)", amount);
    
    Ok(())
}

/// Execute transaction using user's deposit, validated by intent signature
/// 
/// Accounts expected:
/// 0. [] Executor PDA (seeds: ["executor"])
/// 1. [writable] Vault PDA (seeds: ["vault"])
/// 2. [writable] User Deposit PDA (seeds: ["user_deposit", user.key()])
/// 3. [] User (not signer - signature verified via intent)
/// 4. [writable] Execution Account (fund receiver)
/// 5. [] System Program
/// 6. [] Inco Lightning Program
/// 
/// Instruction data:
/// - intent_hash (32 bytes)
/// - signature_length (4 bytes, little-endian u32)
/// - signature (variable length)
/// - amount (8 bytes, little-endian u64)
/// - ciphertext_len (4 bytes, little-endian u32)
/// - ciphertext (variable)
/// - input_type (1 byte)
fn execute_with_intent(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    msg!("Execute with intent");
    
    let accounts_iter = &mut accounts.iter();
    
    let executor_account = next_account_info(accounts_iter)?;
    let vault_account = next_account_info(accounts_iter)?;
    let user_deposit_account = next_account_info(accounts_iter)?;
    let user_account = next_account_info(accounts_iter)?;
    let execution_account = next_account_info(accounts_iter)?;
    let _system_program = next_account_info(accounts_iter)?;
    let inco_program = next_account_info(accounts_iter)?;
    
    // Verify executor PDA
    let (executor_pda, _) = Pubkey::find_program_address(
        &[b"executor"],
        program_id,
    );
    
    if executor_account.key != &executor_pda {
        return Err(ProgramError::InvalidAccountData);
    }

    // Verify execution account matches executor config
    let executor_data = Executor::unpack(&executor_account.data.borrow())?;
    if executor_data.execution_account != *execution_account.key {
        return Err(ProgramError::InvalidAccountData);
    }
    if !execution_account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Verify vault PDA
    let (vault_pda, _) = Pubkey::find_program_address(
        &[b"vault"],
        program_id,
    );
    
    if vault_account.key != &vault_pda {
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Verify user deposit PDA
    let (user_deposit_pda, _) = Pubkey::find_program_address(
        &[b"user_deposit", user_account.key.as_ref()],
        program_id,
    );
    
    if user_deposit_account.key != &user_deposit_pda {
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Parse instruction data
    if data.len() < 36 {
        return Err(ProgramError::InvalidInstructionData);
    }
    
    // Extract intent hash (32 bytes)
    let intent_hash: [u8; 32] = data[0..32].try_into()
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    
    // Extract signature length (4 bytes)
    let signature_len = u32::from_le_bytes([
        data[32], data[33], data[34], data[35],
    ]) as usize;
    
    if data.len() < 36 + signature_len + 8 + 4 + 1 {
        return Err(ProgramError::InvalidInstructionData);
    }
    
    // Extract signature
    let signature = &data[36..36 + signature_len];

    // Extract amount (8 bytes) after signature
    let amount_offset = 36 + signature_len;
    let amount = u64::from_le_bytes([
        data[amount_offset],
        data[amount_offset + 1],
        data[amount_offset + 2],
        data[amount_offset + 3],
        data[amount_offset + 4],
        data[amount_offset + 5],
        data[amount_offset + 6],
        data[amount_offset + 7],
    ]);

    let ciphertext_len_offset = amount_offset + 8;
    let ciphertext_len = u32::from_le_bytes([
        data[ciphertext_len_offset],
        data[ciphertext_len_offset + 1],
        data[ciphertext_len_offset + 2],
        data[ciphertext_len_offset + 3],
    ]) as usize;

    let ciphertext_start = ciphertext_len_offset + 4;
    let ciphertext_end = ciphertext_start + ciphertext_len;
    if data.len() < ciphertext_end + 1 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let ciphertext = &data[ciphertext_start..ciphertext_end];
    let input_type = data[ciphertext_end];
    
    if signature.is_empty() {
        return Err(ProgramError::InvalidArgument);
    }
    
    // Unpack user deposit
    let mut user_deposit = UserDeposit::unpack(&user_deposit_account.data.borrow())?;
    
    // Verify user owns this deposit
    if user_deposit.user != *user_account.key {
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Build encrypted amount from ciphertext and verify it matches plaintext amount
    let encrypted_amount = inco_new_euint128(execution_account, inco_program, ciphertext, input_type)?;
    let plaintext_amount = inco_as_euint128(execution_account, inco_program, amount as u128)?;
    let matches = inco_e_eq(execution_account, inco_program, encrypted_amount, plaintext_amount)?;
    if matches == 0 {
        return Err(ProgramError::InvalidArgument);
    }

    // Encrypted balance check (use execution signer for Inco CPI)
    let sufficient = inco_e_ge(execution_account, inco_program, user_deposit.balance, encrypted_amount)?;
    if amount == 0 || sufficient == 0 {
        return Err(ProgramError::InsufficientFunds);
    }
    
    // TODO: Verify Ed25519 signature of intent_hash
    // For now, we just check that signature is provided
    // In production, use solana_program::ed25519_program or similar
    
    // Deduct encrypted balance and move funds from vault to execution account
    user_deposit.balance = inco_e_sub(execution_account, inco_program, user_deposit.balance, encrypted_amount)?;
    user_deposit.pack_into_slice(&mut user_deposit_account.data.borrow_mut());

    **vault_account.try_borrow_mut_lamports()? -= amount;
    **execution_account.try_borrow_mut_lamports()? += amount;

    msg!("Intent executed for user: {}", user_account.key);
    msg!("Intent hash: {:?}", intent_hash);
    msg!("Transferred {} lamports to execution account", amount);
    msg!("User balance: {} lamports", user_deposit.balance);
    
    // In production, you would:
    // 1. Verify the signature cryptographically
    // 2. Check replay protection (used intents)
    // 3. Execute the actual instructions
    // 4. Deduct the appropriate amount from user deposit
    
    Ok(())
}

/// Executor account state
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Executor {
    pub execution_account: Pubkey,
    pub authority: Pubkey,
    pub is_initialized: bool,
}

impl Sealed for Executor {}

impl IsInitialized for Executor {
    fn is_initialized(&self) -> bool {
        self.is_initialized
    }
}

impl Pack for Executor {
    const LEN: usize = 32 + 32 + 1; // execution_account + authority + is_initialized

    fn pack_into_slice(&self, dst: &mut [u8]) {
        if dst.len() < Executor::LEN {
            return;
        }
        
        dst[0..32].copy_from_slice(self.execution_account.as_ref());
        dst[32..64].copy_from_slice(self.authority.as_ref());
        dst[64] = if self.is_initialized { 1 } else { 0 };
    }

    fn unpack_from_slice(src: &[u8]) -> Result<Self, ProgramError> {
        if src.len() < Executor::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        
        let mut execution_account_bytes = [0u8; 32];
        execution_account_bytes.copy_from_slice(&src[0..32]);
        
        let mut authority_bytes = [0u8; 32];
        authority_bytes.copy_from_slice(&src[32..64]);
        
        Ok(Executor {
            execution_account: Pubkey::new_from_array(execution_account_bytes),
            authority: Pubkey::new_from_array(authority_bytes),
            is_initialized: src[64] == 1,
        })
    }
}

/// User deposit account state
#[derive(Clone, Debug, Default, PartialEq)]
pub struct UserDeposit {
    pub user: Pubkey,
    pub balance: u128,
}

impl Sealed for UserDeposit {}

impl IsInitialized for UserDeposit {
    fn is_initialized(&self) -> bool {
        self.balance > 0 || self.user != Pubkey::default()
    }
}

impl Pack for UserDeposit {
    const LEN: usize = 32 + 16; // user + encrypted balance (u128)

    fn pack_into_slice(&self, dst: &mut [u8]) {
        if dst.len() < UserDeposit::LEN {
            return;
        }
        
        dst[0..32].copy_from_slice(self.user.as_ref());
        dst[32..48].copy_from_slice(&self.balance.to_le_bytes());
    }

    fn unpack_from_slice(src: &[u8]) -> Result<Self, ProgramError> {
        if src.len() < UserDeposit::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        
        let mut balance_bytes = [0u8; 16];
        balance_bytes.copy_from_slice(&src[32..48]);
        
        let mut user_bytes = [0u8; 32];
        user_bytes.copy_from_slice(&src[0..32]);
        
        Ok(UserDeposit {
            user: Pubkey::new_from_array(user_bytes),
            balance: u128::from_le_bytes(balance_bytes),
        })
    }
}

