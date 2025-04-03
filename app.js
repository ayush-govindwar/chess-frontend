document.addEventListener('DOMContentLoaded', function() {
    // Initialize variables
    let socket;
    let chess = new Chess();
    let board = null;
    let gameId = null;
    let playerColor = null;
    let isPlayerTurn = false;
    let timers = { w: 600000, b: 600000 }; // Default 10 minutes per player
    let timerInterval = null;
    let lastMoveTimestamp = Date.now();
    let capturedPieces = { w: [], b: [] };
    let activeTimer = null; // Currently active timer ('w' or 'b')
    let isClockRunning = false;

    // Initialize the board immediately with a starting position
    try {
        board = Chessboard('board', 'start');
        console.log('Initial board setup successful');
    } catch (error) {
        console.error('Initial board setup failed:', error);
        showMessage('Failed to initialize board: ' + error.message, 'error');
    }
    


    
    // Connect to WebSocket server
    function connectToServer() {
        socket = io('https://chess-app-9opx.onrender.com');
        
        // Socket event listeners
        socket.on('connect', () => {
            showMessage('Connected to server', 'success');
        });
        
        socket.on('disconnect', () => {
            showMessage('Disconnected from server', 'error');
            stopTimer(); // Stop timer on disconnect
        });
        
        socket.on('playerJoined', (game) => {
            updateGameState(game);
            if (game.players.length === 2) {
                showMessage('Both players have joined. Game can start!', 'success');
                document.getElementById('status').textContent = 'Game Status: In Progress';
            }
        });
        
        socket.on('gameStarted', (data) => {
            console.log('Game started with time control:', data.timeControl);
            if (data.timeControl) {
                timers = data.timeControl.timeLeft;
                updateTimerDisplay();
                
                // Start white's timer when game begins
                startTimer('w');
            }
        });
        
        socket.on('moveMade', (game) => {
            console.log('Move received from server with timestamp:', game.moveTimestamp);
            
            // Stop current player's timer
            if (activeTimer) {
                stopTimer();
            }
            
            // Update game state
            updateGameState(game);
            
            // Start the timer for the player whose turn it is
            const currentTurn = game.currentTurn;
            console.log(`Starting ${currentTurn}'s timer after move`);
            startTimer(currentTurn, game.moveTimestamp);
            
            // Display the commentary if available
            if (game.lastCommentary) {
                updateCommentary(game.lastCommentary);
            }
        });
        
        // Add new listener for commentary events
        socket.on('commentary', (data) => {
            if (data && data.commentary) {
                updateCommentary(data.commentary);
            }
        });
        
        socket.on('gameOver', (data) => {
            stopTimer(); // Stop all timers when game is over
            showMessage(data.result, 'success');
            document.getElementById('status').textContent = 'Game Status: ' + data.result;
        });
        
        socket.on('moveRejected', (message) => {
            showMessage('Move rejected: ' + message, 'error');
            board.position(chess.fen());  // Reset the board to the previous valid position
            
            // Restart timer for the current player
            startTimer(chess.turn());
        });
        
        socket.on('timerUpdate', (data) => {
            console.log('Timer sync from server:', data);
            
            // Update our timers with the server's values
            // But preserve the current countdown for the active player
            if (activeTimer) {
                const inactiveColor = activeTimer === 'w' ? 'b' : 'w';
                timers[inactiveColor] = data.timeLeft[inactiveColor];
            } else {
                timers = data.timeLeft;
            }
            
            updateTimerDisplay();
        });
    }
    
    // Function to update the commentary display
    function updateCommentary(commentary) {
        const commentaryElement = document.getElementById('commentary');
        if (commentaryElement) {
            commentaryElement.innerHTML = `<strong>Commentary:</strong> ${commentary}`;
            commentaryElement.style.animation = 'fade-in 0.5s';
        }
    }
    
    // Create a new game
    document.getElementById('create-game-btn').addEventListener('click', function() {
        if (!socket) {
            connectToServer();
        }
        
        // Generate a unique game ID
        gameId = generateGameId();
        
        // Display the game ID
        document.getElementById('game-id').textContent = gameId;
        document.getElementById('game-id-display').style.display = 'block';
        
        const initialTime = parseInt(document.getElementById('time-control').value || '600');
        
        // Create the game on the server
        socket.emit('createGame', {
            gameId: gameId,
            timeControl: initialTime
        });
        
        socket.on('createGameResponse', (response) => {
            console.log("Create game response received:", response);
            if (response && response.event === 'gameCreated') {
                console.log('Game created successfully');
                
                playerColor = 'w';  // Creator plays as white
                isPlayerTurn = true;
                
                // Initialize timers from server data
                if (response.data.timeControl) {
                    timers = response.data.timeControl.timeLeft;
                }
                
                initializeBoard();
                updateTimerDisplay();
                showMessage('Game created! Waiting for opponent...', 'success');
                document.getElementById('status').textContent = 'Game Status: Waiting for opponent';
            } else {
                showMessage('Failed to create game', 'error');
            }
        });
    });
    
    // Join an existing game
    document.getElementById('join-game-btn').addEventListener('click', function() {
        if (!socket) {
            connectToServer();
        }
        
        gameId = document.getElementById('game-id-input').value.trim();
        
        if (!gameId) {
            showMessage('Please enter a Game ID', 'error');
            return;
        }
        
        socket.emit('joinGame', gameId);
        socket.on('joinGameResponse', (response) => {
            if (response.event === 'gameJoined') {
                playerColor = 'b';  // Joiner plays as black
                isPlayerTurn = false;
                
                // Initialize timers from server data
                if (response.data.timeControl) {
                    timers = response.data.timeControl.timeLeft;
                }
                
                initializeBoard();
                updateGameState(response.data);
                updateTimerDisplay();
                showMessage('Joined the game!', 'success');
                
                // If white's turn is active, start their timer
                if (response.data.currentTurn === 'w') {
                    startTimer('w');
                }
            } else {
                showMessage('Failed to join game: ' + response.data, 'error');
            }
        });
    });
    
    function startTimer(color, serverTimestamp = null) {
        // Clear any existing timer
        if (timerInterval) {
            clearInterval(timerInterval);
        }
        
        console.log(`Starting timer for ${color}`);
        activeTimer = color;
        isClockRunning = true;
        
        // Record the start time
        lastMoveTimestamp = serverTimestamp || Date.now();
        
        // Start the interval
        timerInterval = setInterval(() => {
            if (!isClockRunning) return;
            
            const now = Date.now();
            const elapsed = now - lastMoveTimestamp;
            
            // Decrement the active timer
            timers[color] -= elapsed;
            
            // Make sure timer doesn't go below zero
            if (timers[color] <= 0) {
                timers[color] = 0;
                stopTimer();
                
                // Game over by timeout - this will be confirmed by server as well
                showMessage(`Time out! ${color === 'w' ? 'White' : 'Black'} loses on time.`, 'error');
                
                // Notify server about timeout if it's our turn
                if (color === playerColor) {
                    socket.emit('timeOut', {
                        gameId: gameId,
                        color: color
                    });
                }
            }
            
            // Update timestamp for next calculation
            lastMoveTimestamp = now;
            
            // Update the display
            updateTimerDisplay();
        }, 100); // Update every 100ms for smoother countdown
    }
    
    function stopTimer() {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        isClockRunning = false;
        activeTimer = null;
        console.log('Timer stopped');
    }
    
    function updateTimerDisplay() {
        const whiteTime = formatTime(timers.w);
        const blackTime = formatTime(timers.b);
        
        document.getElementById('white-timer').textContent = whiteTime;
        document.getElementById('black-timer').textContent = blackTime;
        
        // Highlight active timer
        document.getElementById('white-timer').className = activeTimer === 'w' ? 'timer active' : 'timer';
        document.getElementById('black-timer').className = activeTimer === 'b' ? 'timer active' : 'timer';
        
        // Add warning class when timer is low (less than 30 seconds)
        if (timers.w <= 30000) {
            document.getElementById('white-timer').classList.add('warning');
        } else {
            document.getElementById('white-timer').classList.remove('warning');
        }
        
        if (timers.b <= 30000) {
            document.getElementById('black-timer').classList.add('warning');
        } else {
            document.getElementById('black-timer').classList.remove('warning');
        }
    }
    
    function formatTime(milliseconds) {
        const totalSeconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
    
    // Request timer sync from server
    function syncTimersWithServer() {
        if (socket && gameId) {
            socket.emit('timerSync', {
                gameId: gameId,
                clientTime: Date.now()
            });
        }
    }
    
    // Copy game ID to clipboard
    document.getElementById('copy-id-btn').addEventListener('click', function() {
        const gameIdElement = document.getElementById('game-id');
        const range = document.createRange();
        range.selectNode(gameIdElement);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        document.execCommand('copy');
        window.getSelection().removeAllRanges();
        showMessage('Game ID copied to clipboard!', 'success');
    });
    
    // Initialize chessboard
    function initializeBoard() {
        try {
            console.log("Starting board initialization");
            // If board already exists, destroy it first
            if (board) {
                console.log("Destroying existing board");
                board.destroy();
            }
            
            console.log("Setting up config with playerColor:", playerColor);
            const config = {
                draggable: true,
                position: 'start',
                orientation: playerColor === 'w' ? 'white' : 'black',
                onDragStart: onDragStart,
                onDrop: onDrop,
                onSnapEnd: onSnapEnd
            };
            
            console.log("Creating new chessboard with config", config);
            board = Chessboard('board', config);
            
            console.log("Board created:", board);
            
            // Add window resize event to make the board responsive
            $(window).resize(board.resize);
            // Reset the chess.js instance
            chess = new Chess();
            console.log("Board initialization complete");

            // Reset captured pieces when starting a new game
            capturedPieces = { w: [], b: [] };
            displayCapturedPieces('white-captured', []);
            displayCapturedPieces('black-captured', []);
        } catch (error) {
            console.error('Failed to initialize chessboard:', error);
            showMessage('Failed to initialize board: ' + error.message, 'error');
        }
    }
    
    // Handle piece drag start
    function onDragStart(source, piece) {
        // Only allow the current player to move their pieces
        if (!isPlayerTurn || chess.game_over()) {
            return false;
        }
        
        // Only allow the player to move their own pieces
        if ((playerColor === 'w' && piece.search(/^b/) !== -1) ||
            (playerColor === 'b' && piece.search(/^w/) !== -1)) {
            return false;
        }
        
        // Check if the piece can move from the source square
        const moves = chess.moves({ square: source, verbose: true });
        if (moves.length === 0) {
            return false;
        }
        
        return true;
    }
    
    // Handle piece drop
    function onDrop(source, target, piece, newPos, oldPos, orientation) {
        // Check if this is a pawn promotion
        let promotion = undefined;
        const sourceRank = source.charAt(1);
        const targetRank = target.charAt(1);
        const pieceType = piece.charAt(1).toLowerCase();
        
        if (pieceType === 'p' && 
            ((playerColor === 'w' && targetRank === '8') || 
             (playerColor === 'b' && targetRank === '1'))) {
            promotion = promptForPromotion();
        }
        
        // Check if the move is legal
        try {
            // Create a move object
            const moveObj = {
                from: source,
                to: target,
                promotion: promotion || 'q' // Default to queen if not specified
            };
            
            // Check if the move is legal in the client-side chess.js
            const move = chess.move(moveObj);
            
            if (move === null) {
                console.log('Illegal move detected');
                return 'snapback'; // Illegal move
            }
            console.log('Legal move, updating FEN and sending to server');
            
            // Stop our timer immediately when we make the move
            if (activeTimer === playerColor) {
                stopTimer();
            }
            
            // Get current timestamp for move timing
            const moveTimestamp = Date.now();
            
            // If legal, send the updated FEN to the server
            const fen = chess.fen();
            socket.emit('makeMove', {
                gameId: gameId,
                fen: fen,
                playerId: socket.id,
                timestamp: moveTimestamp // Send client timestamp with move
            });
            
            socket.on('moveResponse',(response)=>{
                if (response && response.event === 'moveRejected') {
                    chess.undo(); // Undo the move locally
                    showMessage('Move rejected: ' + response.data, 'error');
                    board.position(chess.fen());
                    
                    // Restart our timer if move was rejected
                    startTimer(playerColor);
                }
            });
            
            // NOTE: We're not updating captured pieces here anymore
            // The server will send back the updated game state with capture information
            
            // Update move history
            updateMoveHistory();
            
            // Toggle player turn
            isPlayerTurn = false;
            updateTurnUI();
            
            return null; // Legal move
        } catch (e) {
            console.error('Error during move:', e);
            return 'snapback';
        }
    }
    
    // Prompt user for promotion piece
    function promptForPromotion() {
        const pieces = ['q', 'r', 'n', 'b'];
        const piece = prompt('Promote pawn to: (q)ueen, (r)ook, k(n)ight, or (b)ishop', 'q');
        return pieces.includes(piece) ? piece : 'q';
    }
    
    // Update the board after the piece snaps
    function onSnapEnd() {
        board.position(chess.fen());
    }
    
    // Update game state from server
    function updateGameState(game) {
        // Store the current position first
        const oldFen = chess.fen();
        
        // Update with new position
        chess = new Chess(game.fen);
        board.position(game.fen);
        
        // Update timers if time control information is available
        if (game.timeControl && game.timeControl.timeLeft) {
            timers = game.timeControl.timeLeft;
            updateTimerDisplay();
        }
        
        // Always update captured pieces from server data if available
        if (game.capturedPieces) {
            capturedPieces = JSON.parse(JSON.stringify(game.capturedPieces)); // Deep copy
            displayCapturedPieces('white-captured', capturedPieces.w);
            displayCapturedPieces('black-captured', capturedPieces.b);
        } else {
            // If server didn't provide captured pieces, recalculate them
            calculateCapturedPieces();
        }
        
        // Update turn
        isPlayerTurn = (game.currentTurn === playerColor);
        updateTurnUI();
        
        // Update move history
        updateMoveHistory();
        
        // Start timer for the current player's turn if game is active
        if (!game.isGameOver && game.currentTurn) {
            // Start the current player's timer
            startTimer(game.currentTurn);
        }
        
        // Check for game over
        if (game.isGameOver) {
            stopTimer(); // Make sure to stop the timer
            document.getElementById('status').textContent = 'Game Status: ' + game.result;
        }
    }
      
    // Calculate captured pieces from the current game state
    function calculateCapturedPieces() {
        // Get the history
        const history = chess.history({ verbose: true });
        
        // Reset captured pieces arrays
        capturedPieces = { w: [], b: [] };
        
        // Check each move for captures
        history.forEach(move => {
            if (move.captured) {
                if (move.color === 'w') {
                    capturedPieces.w.push(move.captured);
                } else {
                    capturedPieces.b.push(move.captured);
                }
            }
        });
        
        // Always update the display
        displayCapturedPieces('white-captured', capturedPieces.w);
        displayCapturedPieces('black-captured', capturedPieces.b);
    }
    
    // Update turn display
    function updateTurnUI() {
        const turnText = chess.turn() === 'w' ? 'White' : 'Black';
        document.getElementById('turn').textContent = 'Current Turn: ' + turnText;
        
        if (isPlayerTurn) {
            document.getElementById('turn').style.color = '#4CAF50';
        } else {
            document.getElementById('turn').style.color = '#333';
        }
    }
    
    // Update move history display
    function updateMoveHistory() {
        const pgnElement = document.getElementById('pgn');
        pgnElement.textContent = chess.pgn();
        pgnElement.scrollTop = pgnElement.scrollHeight;
    }
    
    // Display captured pieces in the UI
    function displayCapturedPieces(elementId, pieces) {
        console.log(`Displaying captured pieces for ${elementId}:`, pieces);
        const container = document.getElementById(elementId);
    
        // Clear the container
        container.innerHTML = ''; 
    
        // Append captured pieces
        pieces.forEach(piece => {
            const color = elementId === 'white-captured' ? 'b' : 'w'; // Opposite color of capturer
    
            const pieceElement = document.createElement('div');
            pieceElement.className = 'captured-piece';
            pieceElement.style.backgroundImage = `url('./img/chesspieces/wikipedia/${color}${piece.toUpperCase()}.png')`;
            container.appendChild(pieceElement);
        });
    }
    
    // Show a message to the user
    function showMessage(message, type) {
        console.log("showMessage called:", message, type)
        const messageDisplay = document.getElementById('message-display');
        messageDisplay.textContent = message;
        messageDisplay.style.display = 'block';
        
        // Set color based on message type
        if (type === 'error') {
            messageDisplay.style.backgroundColor = '#f8d7da';
            messageDisplay.style.color = '#721c24';
            messageDisplay.style.borderColor = '#f5c6cb';
        } else if (type === 'success') {
            messageDisplay.style.backgroundColor = '#d4edda';
            messageDisplay.style.color = '#155724';
            messageDisplay.style.borderColor = '#c3e6cb';
        } else {
            messageDisplay.style.backgroundColor = '#fff3cd';
            messageDisplay.style.color = '#856404';
            messageDisplay.style.borderColor = '#ffeeba';
        }
        
        // Hide message after 5 seconds
        setTimeout(() => {
            messageDisplay.style.display = 'none';
        }, 5000);
    }
    
    // Generate a random game ID
    function generateGameId() {
        return Math.random().toString(36).substring(2, 10);
    }
    
    // Periodically sync timers with server to prevent desync
    setInterval(syncTimersWithServer, 10000); // Sync every 10 seconds
});