import time
import subprocess
import logging
from datetime import datetime
import os
import sys

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('logs/orchestrator.log'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger("firewall.orchestrator")

def run_agent(script_path):
    logger.info(f"Starting {script_path}...")
    try:
        start_time = time.time()
        # Run the script and capture output for the dashboard regexes
        process = subprocess.Popen(
            [sys.executable, script_path],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True
        )
        
        for line in process.stdout:
            sys.stdout.write(line)
            sys.stdout.flush()
            
        process.wait()
        duration = time.time() - start_time
        
        if process.returncode == 0:
            logger.info(f"Successfully completed {script_path} in {duration:.1f}s")
            return True
        else:
            logger.error(f"Failed {script_path} with exit code {process.returncode}")
            return False
            
    except Exception as e:
        logger.exception(f"Exception running {script_path}: {e}")
        return False

def main():
    os.makedirs('logs', exist_ok=True)
    os.makedirs('data', exist_ok=True)
    
    cycle_count = 0
    cycle_interval = 300 # 5 minutes
    
    logger.info("Starting Agent Firewall Swarm Orchestrator")
    
    while True:
        cycle_count += 1
        cycle_start = time.time()
        logger.info(f"--- Starting Cycle {cycle_count} ---")
        
        # 1. Scout for leads
        run_agent('agents/scout.py')
        run_agent('agents/youtube_scout.py')
        
        # 2. Engage (draft replies)
        run_agent('agents/engager.py')
        
        # 3. Post approved drafts to Reddit
        run_agent('agents/poster.py')
        
        logger.info(f"=== Cycle {cycle_count} Complete ===")
        
        # Sleep until next cycle
        elapsed = time.time() - cycle_start
        sleep_time = max(0, cycle_interval - elapsed)
        
        if sleep_time > 0:
            logger.info(f"Sleeping for {sleep_time:.0f} seconds...")
            time.sleep(sleep_time)

if __name__ == "__main__":
    main()
