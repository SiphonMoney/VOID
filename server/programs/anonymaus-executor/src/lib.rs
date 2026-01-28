//! Void Executor Program - Native Solana Implementation
//! 
//! This program manages user deposits and executes transactions based on signed intents.
//! No Anchor framework - pure native Solana program.

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    program_error::ProgramError,
    program_pack::{IsInitialized, Pack, Sealed},
    pubkey::Pubkey,
    msg,
    sysvar::{rent::Rent, Sysvar},
    system_instruction,
    program::{invoke, invoke_signed},
};

// Program ID - will be replaced during build with actual program ID
// Using a placeholder that's 32 bytes when base58 decoded
solana_program::declare_id!("11111111111111111111111111111111");

// Entry point
entrypoint!(process_instruction);

// Instruction discriminator constants
const INITIALIZE: u8 = 0;
const DEPOSIT: u8 = 1;
const WITHDRAW: u8 = 2;
const EXECUTE_WITH_INTENT: u8 = 3;

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
/// 3. [] System Program
/// 
/// Instruction data: amount (8 bytes, little-endian u64)
fn deposit(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    msg!("Deposit SOL to vault");
    
    let accounts_iter = &mut accounts.iter();
    
    let vault_account = next_account_info(accounts_iter)?;
    let user_account = next_account_info(accounts_iter)?;
    let user_deposit_account = next_account_info(accounts_iter)?;
    let system_program = next_account_info(accounts_iter)?;
    
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
    
    // Update user deposit balance
    let mut user_deposit = if user_deposit_account.data.borrow()[0] == 0 {
        // Initialize if new account (just created)
        UserDeposit {
            user: *user_account.key,
            balance: 0,
        }
    } else {
        // Unpack existing account
        UserDeposit::unpack(&user_deposit_account.data.borrow())?
    };
    
    user_deposit.balance = user_deposit.balance
        .checked_add(amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    user_deposit.pack_into_slice(&mut user_deposit_account.data.borrow_mut());
    
    msg!("Deposited {} lamports. New balance: {}", amount, user_deposit.balance);
    
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
    
    // Check sufficient balance
    if user_deposit.balance < amount {
        msg!("Insufficient balance: {} < {}", user_deposit.balance, amount);
        return Err(ProgramError::InsufficientFunds);
    }
    
    // Update balance
    user_deposit.balance = user_deposit.balance
        .checked_sub(amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    user_deposit.pack_into_slice(&mut user_deposit_account.data.borrow_mut());
    
    // Transfer SOL from vault to user
    **vault_account.try_borrow_mut_lamports()? -= amount;
    **user_account.try_borrow_mut_lamports()? += amount;
    
    msg!("Withdrew {} lamports. New balance: {}", amount, user_deposit.balance);
    
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
/// 
/// Instruction data:
/// - intent_hash (32 bytes)
/// - signature_length (4 bytes, little-endian u32)
/// - signature (variable length)
/// - amount (8 bytes, little-endian u64)
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
    
    if data.len() < 36 + signature_len + 8 {
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
    
    if signature.is_empty() {
        return Err(ProgramError::InvalidArgument);
    }
    
    // Unpack user deposit
    let user_deposit = UserDeposit::unpack(&user_deposit_account.data.borrow())?;
    
    // Verify user owns this deposit
    if user_deposit.user != *user_account.key {
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Check balance > 0 (actual amount needed would be determined by instructions)
    if user_deposit.balance < amount || amount == 0 {
        return Err(ProgramError::InsufficientFunds);
    }
    
    // TODO: Verify Ed25519 signature of intent_hash
    // For now, we just check that signature is provided
    // In production, use solana_program::ed25519_program or similar
    
    // Deduct balance and move funds from vault to execution account
    user_deposit.balance = user_deposit.balance
        .checked_sub(amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;
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
    pub balance: u64,
}

impl Sealed for UserDeposit {}

impl IsInitialized for UserDeposit {
    fn is_initialized(&self) -> bool {
        self.balance > 0 || self.user != Pubkey::default()
    }
}

impl Pack for UserDeposit {
    const LEN: usize = 32 + 8; // user + balance

    fn pack_into_slice(&self, dst: &mut [u8]) {
        if dst.len() < UserDeposit::LEN {
            return;
        }
        
        dst[0..32].copy_from_slice(self.user.as_ref());
        dst[32..40].copy_from_slice(&self.balance.to_le_bytes());
    }

    fn unpack_from_slice(src: &[u8]) -> Result<Self, ProgramError> {
        if src.len() < UserDeposit::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        
        let mut balance_bytes = [0u8; 8];
        balance_bytes.copy_from_slice(&src[32..40]);
        
        let mut user_bytes = [0u8; 32];
        user_bytes.copy_from_slice(&src[0..32]);
        
        Ok(UserDeposit {
            user: Pubkey::new_from_array(user_bytes),
            balance: u64::from_le_bytes(balance_bytes),
        })
    }
}

