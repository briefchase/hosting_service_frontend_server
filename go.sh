#!/bin/bash

# Script Output Conventions:
# - Use complete sentences for all output messages.
# - Report actions only *after* they have been successfully completed or failed, using the past tense.
# Main Menu Modification:
# - Do not modify the main menu options without explicit user request.

#======================================
# Helper & Task Functions
#======================================
_GO_SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

# Source scripts in a way that makes functions available in current shell
source "$_GO_SCRIPT_DIR/scripts/config.sh" || { echo "Error: Failed to source config.sh" >&2; exit 1; }

# Check for jq and install if not present
if ! command -v jq &> /dev/null; then
    echo "jq is not installed. Attempting to install..."
    # Add installation command for your specific OS, e.g., sudo apt-get install jq
    sudo apt-get install -y jq || { echo "Error: Failed to install jq. Please install it manually." >&2; exit 1; }
fi

source "$_GO_SCRIPT_DIR/scripts/install.sh" || { echo "Error: Failed to source install.sh" >&2; exit 1; }
source "$_GO_SCRIPT_DIR/scripts/templating.sh" || { echo "Error: Failed to source templating.sh" >&2; exit 1; }
source "$_GO_SCRIPT_DIR/scripts/deploy.sh" || { echo "Error: Failed to source deploy.sh" >&2; exit 1; }
source "$_GO_SCRIPT_DIR/scripts/utilities.sh" || { echo "Error: Failed to source utilities.sh" >&2; exit 1; }

#======================================
# Main Menu & Script Execution
#======================================

show_menu() {
    echo "--- Firebase Hosting Menu ---"
    echo " 1. Deploy Local (Emulator)"
    echo " 2. Deploy Remote (Firebase)"
    echo " 3. Nuke Menu"
    echo " 4. Exit"
    echo "-------------------------"
}

show_nuke_menu() {
    echo "--- Nuke Menu ---"
    echo "1. Nuke Local (Clean Public)"
    echo "2. Back to Main Menu"
    echo "-------------------"
}

# Main script execution loop
while true; do
    show_menu
    read -p "Enter choice [1-4]: " choice
    echo ""

    # --- Configuration handled per deployment type ---

    operation_failed=false
    deployment_type=""
    # Confirmation vars will be set in cases after prompting
    CONFIRM_DOCKER_PUSH="n"; CONFIRM_TF_APPLY="n"; CONFIRM_TF_DESTROY="n"

    case $choice in
        1) # Update Local (Firebase Emulator)
           deployment_type="local"
           
           read -p "skip config? (y/n) [default: y]: " skip_config_input
           skip_config="${skip_config_input:-y}"

           if [[ "$skip_config" =~ ^[Yy]$ ]]; then
                echo "Skipping interactive configuration and using saved values."
                load_config "$deployment_type"
           else
               echo "Starting local configuration..."
               load_config "$deployment_type" || operation_failed=true
               if [ "$operation_failed" = false ]; then
                   configure_deployment "$_GO_SCRIPT_DIR" "$deployment_type" || operation_failed=true
               fi
           fi
           
           if [ "$operation_failed" = false ]; then
               deployment_name="${CFG_DEPLOYMENT_NAME:-website-local}"
               deploy "$deployment_type" "$deployment_name" || operation_failed=true
           fi
           ;;
        2) # Update Remote (Firebase Hosting)
           deployment_type="remote"
           
           read -p "skip config? (y/n) [default: y]: " skip_config_input
           skip_config="${skip_config_input:-y}"

           if [[ "$skip_config" =~ ^[Yy]$ ]]; then
                echo "Skipping interactive configuration and using saved values."
                load_config "$deployment_type"
           else
               echo "Starting remote configuration..."
               load_config "$deployment_type" || operation_failed=true
               if [ "$operation_failed" = false ]; then
                   configure_deployment "$_GO_SCRIPT_DIR" "$deployment_type" || operation_failed=true
               fi
           fi
           
           if [ "$operation_failed" = false ]; then
               deployment_name="${CFG_DEPLOYMENT_NAME:-website-remote}"
               deploy "$deployment_type" "$deployment_name" || operation_failed=true
           fi
           ;;
        3) # Nuke Menu
            while true; do
                show_nuke_menu
                read -p "Nuke Menu - Enter choice [1-2]: " nuke_choice
                echo ""
                case $nuke_choice in
                    1) # Nuke Local
                        echo "Cleaning public directory..."
                        rm -rf "$_GO_SCRIPT_DIR/public"/*
                        echo "Public directory cleaned."
                        break
                        ;;
                    2) # Back to Main Menu
                        echo "Returning to main menu..."
                        break
                        ;;
                    *)
                        echo "Invalid choice for Nuke Menu [1-2]." >&2
                        operation_failed=true
                        ;;
                esac
                if [[ "$nuke_choice" -ge 1 && "$nuke_choice" -le 2 ]]; then
                    break
                fi
            done
            ;;
        4) # Exit
           echo "Exiting."
           exit 0
           ;;
        *)
            echo "Invalid choice. Please enter a number between 1 and 4." >&2
            operation_failed=true
            ;;
    esac

    # Report if the chosen operation failed, except for invalid choice or exit
    if [ "$operation_failed" = true ] && [[ "$choice" -ge 1 && "$choice" -le 3 ]]; then # Adjusted range (1-3 for operations)
      echo "-------------------------"
      echo "Operation ($choice) failed. See messages above for details." >&2
      echo "-------------------------"
    fi

    echo ""
    read -n 1 -s -r -p "Press any key to continue..."
    echo ""
    clear
done 