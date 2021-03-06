import times from 'lodash/times'
import shuffle from 'lodash/shuffle'
import { gameStates, tileBombStates, tileUserStates, difficulties } from './values'
import { countProximities, allDirections } from './calculations'

const restart = ({
  difficultyID,
  settings
}) => {
  if (!settings) {
    settings = difficulties[difficultyID]
  }

  if (!settings) {
    throw new Error(`Unknown difficulty '${difficultyID}'`)
  }
  const { columns, rows, bombOdds } = settings

  const tilesCount = columns * rows
  let bombsCount = Math.round(bombOdds * tilesCount)

  const shuffledBombs = shuffle(
    times(bombsCount, () => true).concat(times(tilesCount - bombsCount, () => false))
  )

  const board = times(rows, (rowIndex) => (
    times(columns, (columnIndex) => {
      // const hasBomb = Math.random() <= bombOdds
      // bombsCount += (hasBomb ? 1 : 0)
      const hasBomb = shuffledBombs[rowIndex * rows + columnIndex]
      return {
        bombState: hasBomb ? tileBombStates.bomb : tileBombStates.blank,
        userState: tileUserStates.covered
      }
    })
  ))

  const proximities = countProximities(board)

  return {
    gameState: gameStates.fresh,
    columns,
    rows,
    board,
    proximities,
    bombsCount,
    uncoveredCount: 0,
    flagsCount: 0,
    movesCount: 0,
    startedAt: null
  }
}

export const initial = (props) => restart(props)

export function *load(next, prev) {
  // Restart when difficulty changes
  if (!!prev && prev.difficultyID !== next.difficultyID) {
    // Read settings for previous and next difficulties
    let prevSettings = difficulties[prev.difficultyID]
    let nextSettings = difficulties[next.difficultyID]

    let columnsForFraction = (f) => prevSettings.columns + Math.round((nextSettings.columns - prevSettings.columns) * f)
    let rowsForFraction = (f) => prevSettings.rows + Math.round((nextSettings.rows - prevSettings.rows) * f)

    const totalFrames = 12
    // Tween between settings
    for (let frame = 0; frame < totalFrames; frame += 1) {
      yield restart({
        settings: {
          ...nextSettings,
          columns: columnsForFraction(frame / totalFrames),
          rows: rowsForFraction(frame / totalFrames),
        }
      })
    }

    yield restart(next)
  }
}

export const beginRestart = () => ({ gameState: gameStates.restarting })
export const completeRestart = restart

const changeBoardItem = (board, rowIndex, colIndex, changeItem) => (
  board.map((row, currentRowIndex) => (
    row.map((item, currentColIndex) => (
      (rowIndex === currentRowIndex && colIndex === currentColIndex) ? (
        changeItem(item)
      ) : (
        item
      )
    ))
  ))
)

const copyBoard = (board) => (
  board.map((row) => row.slice())
)

const changeItemToUncovered = (item) => (
  (item.bombState === tileBombStates.bomb) ? (
    { ...item, userState: tileUserStates.hitBomb }
  ) : (
    { ...item, userState: tileUserStates.open }
  )
)

const canPlayForGameState = (gameState) => (
  gameState === gameStates.fresh || gameState === gameStates.playing || gameState === gameStates.beginningMove
)

const canExpandTile = (item, proximity) => (
  item.bombState === tileBombStates.blank && proximity === 0
)

export const beginUncoverTile = () => ({ gameState, startedAt }) => {
  if (!canPlayForGameState(gameState)) {
    return
  }

  if (gameState === gameStates.fresh) {
    startedAt = Date.now()
  }

  return {
    gameState: gameStates.beginningMove,
    startedAt
  }
}

export const uncoverTile = (props, { rowIndex, colIndex }) => ({
  gameState, board, proximities, rows, columns, bombsCount, uncoveredCount, flagsCount, movesCount
}) => {
  if (!canPlayForGameState(gameState)) {
    return
  }

  // Don’t allow a game to start with a bomb
  if (movesCount === 0) {
    while (board[rowIndex][colIndex].bombState === tileBombStates.bomb) {
      const newState = restart(props)
      board = newState.board
      proximities = newState.proximities
    }
  }

  let gameOver = false
  let newBoard = copyBoard(board)

  const uncoverInNewBoard = (rowIndex, colIndex) => {
    if (gameOver) {
      return
    }

    const prevItem = newBoard[rowIndex][colIndex]
    const proximity = proximities[rowIndex][colIndex]
    if (prevItem.userState === tileUserStates.open) {
      return
    }

    const newItem = changeItemToUncovered(prevItem)
    newBoard[rowIndex][colIndex] = newItem

    gameOver = newItem.userState === tileUserStates.hitBomb
    if (gameOver) {
      return
    }

    uncoveredCount += 1

    if (prevItem.userState === tileUserStates.flag) {
      flagsCount -= 1
    }

    if (canExpandTile(newItem, proximity)) {
      allDirections.forEach((f) => {
        const [r, c] = f(rowIndex, colIndex)
        if (r < rows && r >= 0 && c < columns && c >= 0) {
          uncoverInNewBoard(r, c)
        }
      })
    }
  }

  uncoverInNewBoard(rowIndex, colIndex)

  const won = uncoveredCount + bombsCount === columns * rows

  const newGameState = gameOver ? (
    gameStates.gameOver
  ) : won ? (
    gameStates.winner
  ) : (
    gameStates.playing
  )

  return {
    board: newBoard,
    proximities,
    gameState: newGameState,
    uncoveredCount,
    flagsCount,
    movesCount: movesCount + 1,
    finishedAt: gameOver || won ? Date.now() : null
  }
}

export const flagTile = (props, { rowIndex, colIndex }) => ({ board, flagsCount }) => {
  const noticeChange = (input, changeBy) => {
    flagsCount += changeBy
    return input
  }

  return {
    board: changeBoardItem(board, rowIndex, colIndex, (item) => (
      (item.userState === tileUserStates.covered) ? (
        noticeChange({ ...item, userState: tileUserStates.flag }, +1)
      ) : (item.userState === tileUserStates.flag) ? (
        noticeChange({ ...item, userState: tileUserStates.covered }, -1)
      ) : (
        item
      )
    )),
    flagsCount
  }
}
