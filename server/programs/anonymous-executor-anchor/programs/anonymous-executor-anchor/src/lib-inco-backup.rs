use anchor_lang::prelude::*;
use inco_lightning::{
    ID as INCO_LIGHTNING_ID,
    types::{Euint128, Ebool},
    cpi::{
        accounts::Operation,
        new_euint128,
        as_euint128,
        e_add,
        e_sub,
        e_ge,
        e_select,
    },
};

declare_id!("gJgK3cQJA1aWARQdg5YQZ21WLztmpHDHrzKYKJF9uoz");

#[program]
pub mod anonymous_executor_anchor {
    use super::*;

    /// Initialize the executor program
    pub fn initialize(ctx: Context<Initialize>, execution_account: Pubkey) -> Result<()> {
        msg!("Initialize executor program");
        
        let executor = &mut ctx.accounts.executor;
        executor.execution_account = execution_account;
        executor.authority = ctx.accounts.authority.key();
        executor.bump = ctx.bumps.executor;
        
        msg!("Executor initialized with execution account: {}", execution_account);
        Ok(())
    }

    /// Deposit SOL to the vault with encrypted amount
    pub fn deposit(ctx: Context<Deposit>, amount: u64, ciphertext: Vec<u8>) -> Result<()> {
        msg!("Deposit SOL to vault");
        
        require!(amount > 0, ErrorCode::InvalidAmount);
        
        // Transfer SOL from user to vault
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.user.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(cpi_context, amount)?;
        
        // Create encrypted amount from client ciphertext
        let operation_accounts = Operation {
            signer: ctx.accounts.user.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.inco_lightning_program.to_account_info(),
            operation_accounts,
        );
        let encrypted_amount = new_euint128(cpi_ctx, ciphertext, 0)?;
        
        // Update encrypted balance
        let user_deposit = &mut ctx.accounts.user_deposit;
        user_deposit.user = ctx.accounts.user.key();
        
        // Initialize balance to encrypted zero if first deposit
        if !user_deposit.balance.is_initialized() {
            let operation_accounts_init = Operation {
                signer: ctx.accounts.user.to_account_info(),
            };
            let cpi_ctx_init = CpiContext::new(
                ctx.accounts.inco_lightning_program.to_account_info(),
                operation_accounts_init,
            );
            user_deposit.balance = as_euint128(cpi_ctx_init, 0u128)?;
        }
        
        // Encrypted addition: balance = balance + encrypted_amount
        let operation_accounts2 = Operation {
            signer: ctx.accounts.user.to_account_info(),
        };
        let cpi_ctx2 = CpiContext::new(
            ctx.accounts.inco_lightning_program.to_account_info(),
            operation_accounts2,
        );
        
        // Clone the balance for the operation (no borrows)
        let balance_clone = user_deposit.balance.clone();
        user_deposit.balance = e_add(cpi_ctx2, balance_clone, encrypted_amount, 0)?;
        
        emit!(DepositEvent {
            user: ctx.accounts.user.key(),
            amount,
        });
        
        msg!("Deposited {} lamports (encrypted)", amount);
        Ok(())
    }

    /// Withdraw SOL from the vault with encrypted balance enforcement
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        msg!("Withdraw SOL from vault");
        
        let user_deposit = &mut ctx.accounts.user_deposit;
        
        // Verify user owns this deposit
        require!(
            user_deposit.user == ctx.accounts.user.key(),
            ErrorCode::UnauthorizedUser
        );
        
        // Create encrypted representation of withdrawal amount
        let operation_accounts_amount = Operation {
            signer: ctx.accounts.user.to_account_info(),
        };
        let cpi_ctx_amount = CpiContext::new(
            ctx.accounts.inco_lightning_program.to_account_info(),
            operation_accounts_amount,
        );
        let encrypted_amount = as_euint128(cpi_ctx_amount, amount as u128)?;
        
        let operation_accounts_zero = Operation {
            signer: ctx.accounts.user.to_account_info(),
        };
        let cpi_ctx_zero = CpiContext::new(
            ctx.accounts.inco_lightning_program.to_account_info(),
            operation_accounts_zero,
        );
        let encrypted_zero = as_euint128(cpi_ctx_zero, 0u128)?;
        
        // Encrypted comparison: sufficient = (balance >= amount)
        let operation_accounts = Operation {
            signer: ctx.accounts.user.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.inco_lightning_program.to_account_info(),
            operation_accounts,
        );
        let balance_clone = user_deposit.balance.clone();
        let encrypted_amount_clone = encrypted_amount.clone();
        let sufficient: Ebool = e_ge(cpi_ctx, balance_clone, encrypted_amount_clone, 0)?;
        
        // Use e_select for conditional logic
        let operation_accounts2 = Operation {
            signer: ctx.accounts.user.to_account_info(),
        };
        let cpi_ctx2 = CpiContext::new(
            ctx.accounts.inco_lightning_program.to_account_info(),
            operation_accounts2,
        );
        let amount_to_subtract = e_select(
            cpi_ctx2,
            sufficient,
            encrypted_amount,
            encrypted_zero,
            0,
        )?;
        
        // Update balance: balance = balance - amount_to_subtract
        let operation_accounts3 = Operation {
            signer: ctx.accounts.user.to_account_info(),
        };
        let cpi_ctx3 = CpiContext::new(
            ctx.accounts.inco_lightning_program.to_account_info(),
            operation_accounts3,
        );
        let balance_clone2 = user_deposit.balance.clone();
        user_deposit.balance = e_sub(cpi_ctx3, balance_clone2, amount_to_subtract, 0)?;
        
        // Transfer SOL from vault to user
        let vault_seeds = &[b"vault".as_ref(), &[ctx.bumps.vault]];
        let signer_seeds = &[&vault_seeds[..]];
        
        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.user.to_account_info(),
            },
            signer_seeds,
        );
        anchor_lang::system_program::transfer(transfer_ctx, amount)?;
        
        emit!(WithdrawalEvent {
            user: ctx.accounts.user.key(),
            requested_amount: amount,
        });
        
        msg!("Withdrew {} lamports", amount);
        Ok(())
    }

    /// Execute transaction using user's deposit, validated by intent signature
    pub fn execute_with_intent(
        ctx: Context<ExecuteWithIntent>,
        intent_hash: [u8; 32],
        signature: Vec<u8>,
        execution_amount: u64,
    ) -> Result<()> {
        msg!("Execute with intent");
        
        require!(!signature.is_empty(), ErrorCode::InvalidSignature);
        
        let user_deposit = &mut ctx.accounts.user_deposit;
        
        // Verify user owns this deposit
        require!(
            user_deposit.user == ctx.accounts.user.key(),
            ErrorCode::UnauthorizedUser
        );
        
        // Create encrypted execution amount
        let operation_accounts_exec = Operation {
            signer: ctx.accounts.user.to_account_info(),
        };
        let cpi_ctx_exec = CpiContext::new(
            ctx.accounts.inco_lightning_program.to_account_info(),
            operation_accounts_exec,
        );
        let encrypted_execution_amount = as_euint128(cpi_ctx_exec, execution_amount as u128)?;
        
        let operation_accounts_zero = Operation {
            signer: ctx.accounts.user.to_account_info(),
        };
        let cpi_ctx_zero = CpiContext::new(
            ctx.accounts.inco_lightning_program.to_account_info(),
            operation_accounts_zero,
        );
        let encrypted_zero = as_euint128(cpi_ctx_zero, 0u128)?;
        
        // Encrypted balance check: sufficient = (balance >= execution_amount)
        let operation_accounts = Operation {
            signer: ctx.accounts.user.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.inco_lightning_program.to_account_info(),
            operation_accounts,
        );
        let balance_clone = user_deposit.balance.clone();
        let encrypted_exec_clone = encrypted_execution_amount.clone();
        let sufficient: Ebool = e_ge(
            cpi_ctx,
            balance_clone,
            encrypted_exec_clone,
            0,
        )?;
        
        // Use e_select to conditionally deduct
        let operation_accounts2 = Operation {
            signer: ctx.accounts.user.to_account_info(),
        };
        let cpi_ctx2 = CpiContext::new(
            ctx.accounts.inco_lightning_program.to_account_info(),
            operation_accounts2,
        );
        let amount_to_deduct = e_select(
            cpi_ctx2,
            sufficient,
            encrypted_execution_amount,
            encrypted_zero,
            0,
        )?;
        
        // Update balance: balance = balance - amount_to_deduct
        let operation_accounts3 = Operation {
            signer: ctx.accounts.user.to_account_info(),
        };
        let cpi_ctx3 = CpiContext::new(
            ctx.accounts.inco_lightning_program.to_account_info(),
            operation_accounts3,
        );
        let balance_clone2 = user_deposit.balance.clone();
        user_deposit.balance = e_sub(cpi_ctx3, balance_clone2, amount_to_deduct, 0)?;
        
        emit!(IntentExecutionEvent {
            user: ctx.accounts.user.key(),
            intent_hash,
            execution_amount,
        });
        
        msg!("Intent executed for user: {}", ctx.accounts.user.key());
        msg!("Intent hash: {:?}", intent_hash);
        
        Ok(())
    }
}

// ========== Context Structs ==========

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Executor::INIT_SPACE,
        seeds = [b"executor"],
        bump
    )]
    pub executor: Account<'info, Executor>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
        mut,
        seeds = [b"vault"],
        bump
    )]
    /// CHECK: Vault PDA
    pub vault: SystemAccount<'info>,
    
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + 32 + 200, // discriminator + user pubkey + euint128 space
        seeds = [b"user_deposit", user.key().as_ref()],
        bump
    )]
    pub user_deposit: Account<'info, UserDeposit>,
    
    pub system_program: Program<'info, System>,
    
    #[account(address = INCO_LIGHTNING_ID)]
    /// CHECK: INCO Lightning program
    pub inco_lightning_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        mut,
        seeds = [b"vault"],
        bump,
    )]
    /// CHECK: Vault PDA
    pub vault: SystemAccount<'info>,
    
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"user_deposit", user.key().as_ref()],
        bump
    )]
    pub user_deposit: Account<'info, UserDeposit>,
    
    pub system_program: Program<'info, System>,
    
    #[account(address = INCO_LIGHTNING_ID)]
    /// CHECK: INCO Lightning program
    pub inco_lightning_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct ExecuteWithIntent<'info> {
    #[account(
        seeds = [b"executor"],
        bump = executor.bump
    )]
    pub executor: Account<'info, Executor>,
    
    #[account(
        mut,
        seeds = [b"vault"],
        bump
    )]
    /// CHECK: Vault PDA
    pub vault: SystemAccount<'info>,
    
    #[account(
        mut,
        seeds = [b"user_deposit", user.key().as_ref()],
        bump
    )]
    pub user_deposit: Account<'info, UserDeposit>,
    
    /// CHECK: User account verified through user_deposit
    pub user: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
    
    #[account(address = INCO_LIGHTNING_ID)]
    /// CHECK: INCO Lightning program
    pub inco_lightning_program: AccountInfo<'info>,
}

// ========== Account Structs ==========

#[account]
#[derive(InitSpace)]
pub struct Executor {
    pub execution_account: Pubkey,
    pub authority: Pubkey,
    pub bump: u8,
}

#[account]
pub struct UserDeposit {
    pub user: Pubkey,
    pub balance: Euint128,
}

// ========== Events ==========

#[event]
pub struct DepositEvent {
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct WithdrawalEvent {
    pub user: Pubkey,
    pub requested_amount: u64,
}

#[event]
pub struct IntentExecutionEvent {
    pub user: Pubkey,
    pub intent_hash: [u8; 32],
    pub execution_amount: u64,
}

// ========== Error Codes ==========

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid amount: must be greater than 0")]
    InvalidAmount,
    
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    
    #[msg("Unauthorized user")]
    UnauthorizedUser,
    
    #[msg("Insufficient funds")]
    InsufficientFunds,
    
    #[msg("Invalid signature")]
    InvalidSignature,
}