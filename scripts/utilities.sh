#!/bin/bash

# Function to check DNS resolution for a domain
check_dns_resolution() {
    local domain="$1"
    if [ -z "$domain" ]; then
        echo "Error: Domain must be provided to check_dns_resolution." >&2
        return 1
    fi

    echo "Checking DNS resolution for domain: $domain"
    if nslookup "$domain" &>/dev/null; then
        echo "DNS resolution successful for domain: $domain"
        return 0
    else
        echo "DNS resolution failed for domain: $domain"
        return 1
    fi
}

# Allow calling functions directly if script is executed
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    echo "This script (${BASH_SOURCE[0]}) is intended to be sourced. Use the main 'go.sh' script instead." >&2
    exit 1
fi

# Export functions to be available to the main script
export -f check_dns_resolution
