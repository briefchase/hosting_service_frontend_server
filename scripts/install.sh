#!/bin/bash

# Helper function to get GCP Project ID
get_project_id() {
    gcloud config get-value project 2>/dev/null
}

# Function to check and setup GCP SDK and environment
check_gcp() {
    if ! command -v gcloud &>/dev/null; then
        echo "Google Cloud SDK is not installed. Attempting installation."
        local gcloud_repo="deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main"
        local repo_file="/etc/apt/sources.list.d/google-cloud-sdk.list"
        
        if [ ! -f "$repo_file" ] || ! grep -qF "$gcloud_repo" "$repo_file"; then
            echo "$gcloud_repo" | sudo tee "$repo_file" > /dev/null || { echo "Error: Adding the GCloud repository failed." >&2; return 1; }
        fi
        
        curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | sudo apt-key --keyring /usr/share/keyrings/cloud.google.gpg add - || { echo "Error: Adding the GCloud key failed." >&2; return 1; }
        sudo apt update && sudo apt install -y google-cloud-sdk google-cloud-sdk-app-engine-python google-cloud-sdk-app-engine-python-extras google-cloud-sdk-beta || { echo "Error: Installing the GCloud SDK and components failed." >&2; return 1; }
        echo "Google Cloud SDK and beta components were installed successfully."
    else
        echo "Google Cloud SDK installation was verified. Ensuring beta components are present..."
        # Check if beta component is installed, if not try to install it
        if ! gcloud components list --filter="id:beta" --format="value(id)" | grep -q "beta"; then
            echo "GCloud beta components not found. Attempting installation..."
            # For apt-based installs, we should use apt to install the component package
            if command -v apt-get &>/dev/null; then
                sudo apt-get update && sudo apt-get install -y google-cloud-sdk-beta || echo "Warning: Could not install google-cloud-sdk-beta via apt. Trying gcloud components install..."
            fi
            # Fallback to gcloud's own component manager if apt didn't work or isn't used
            gcloud components install beta --quiet || echo "Warning: Failed to install beta components. Some commands may fail."
        else
            echo "GCloud beta components verified."
        fi
    fi

    if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" &>/dev/null; then
        echo "Google Cloud authentication is required."
        gcloud auth login --no-launch-browser || { echo "Error: GCloud login failed." >&2; return 1; }
        echo "Google Cloud authentication succeeded."
    else
        echo "Google Cloud authentication was verified."
    fi

    local project_id=$(get_project_id)
    if [ -z "$project_id" ] || [ "$project_id" = "(unset)" ]; then
        echo "No GCP project is configured."
        read -p "Enter your GCP project ID: " new_project_id
        gcloud config set project "$new_project_id" || { echo "Error: Setting the project failed." >&2; return 1; }
        project_id="$new_project_id"
        echo "The GCP project was set to: $project_id."
    else
        echo "The GCP project is configured: $project_id."
    fi

    local billing_status=$(gcloud billing projects describe "$project_id" --format="get(billingEnabled)" 2>/dev/null)
    if [ "$billing_status" != "True" ]; then
        echo "Error: No billing account was found for project $project_id, or billing is not enabled. Please set up billing:" >&2
        echo "1. Visit https://console.cloud.google.com/billing" >&2
        echo "2. Link project '$project_id' to a billing account." >&2
        echo "3. Run this script again." >&2
        return 1
    else
        echo "Billing was verified for project $project_id."
    fi

    # Enable necessary APIs for Firebase deployment
    echo "Enabling required Google Cloud services..."
    gcloud services enable firebasehosting.googleapis.com cloudresourcemanager.googleapis.com --project="$project_id" || { echo "Error: Enabling one or more required GCP services failed." >&2; return 1; }
    echo "Required Google Cloud services were enabled."
}

# Function to check and install Node.js
check_nodejs() {
    if command -v node &>/dev/null && command -v npm &>/dev/null; then
        echo "Node.js and npm installation was verified."
        return 0
    fi
    echo "Node.js/npm is not installed. Attempting installation."
    
    # Install Node.js and npm
    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - || { echo "Error: Failed to add Node.js repository." >&2; return 1; }
    sudo apt-get install -y nodejs || { echo "Error: Failed to install Node.js." >&2; return 1; }
    
    echo "Node.js and npm were installed successfully."
}

# Function to check and install Firebase CLI
check_firebase_cli() {
    if command -v firebase &>/dev/null; then
        echo "Firebase CLI installation was verified."
        return 0
    fi

    echo "Firebase CLI not found. Attempting clean installation..."
    # Clean up any potentially corrupted global installation directories first
    # This addresses the ENOTEMPTY error by removing ghost directories
    sudo rm -rf /usr/lib/node_modules/firebase-tools /usr/lib/node_modules/.firebase-tools* 2>/dev/null
    
    # Attempt the installation
    sudo npm install -g firebase-tools || { echo "Error: Firebase CLI installation failed." >&2; return 1; }
    
    if command -v firebase &>/dev/null; then
        echo "Firebase CLI was installed successfully."
        return 0
    fi

    echo "Error: Firebase CLI was installed but still cannot be found in PATH." >&2
    return 1
}

# Ensure jq is installed
if ! command -v jq &> /dev/null; then
    echo "jq is not installed. Attempting to install..."
    if command -v sudo &> /dev/null && command -v apt-get &> /dev/null; then
        sudo apt-get update && sudo apt-get install -y jq
    elif command -v sudo &> /dev/null && command -v yum &> /dev/null; then
        sudo yum install -y jq
    elif command -v sudo &> /dev/null && command -v dnf &> /dev/null; then
        sudo dnf install -y jq
    else
        echo "Error: Could not install jq automatically. Please install it manually using your system's package manager." >&2
        return 1
    fi
    if ! command -v jq &> /dev/null; then
        echo "Error: jq installation failed. Please install it manually." >&2
        return 1
    fi
    echo "jq has been successfully installed."
fi

# Allow calling functions directly if script is executed
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    echo "This script (${BASH_SOURCE[0]}) is intended to be sourced. Use the main 'go.sh' script instead." >&2
    exit 1
fi
